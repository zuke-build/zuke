/**
 * Cancel a run and run its compensations — the cancellation half of the
 * durable-run lifecycle (see `./resume.ts` for the resume half, and
 * `./target.ts` `.onCancel(...)` for the authoring surface).
 *
 * {@link cancelRun} takes a build and a run id, transitions the run
 * `running`/`suspended → cancelling` (a compare-and-swap so a live owning
 * process observes the change and stops — see
 * {@link "./state/writer.ts".RunStateWriter}), runs the **compensations** of the
 * targets that had already succeeded — in reverse topological order, so later
 * work is unwound before the work it built on — releases the run's grip on any
 * locks (the owning process frees them as it aborts; the TTL is the backstop),
 * and settles the record as `cancelled`. A second cancel of an
 * already-terminal run is a friendly no-op.
 *
 * A compensation body gets a normal {@link TargetContext} whose `state` exposes
 * **the original target's** persisted metadata — a deploy that recorded
 * `{ slot: "sit-7" }` can be rolled back from exactly that slot. Compensation
 * failures are recorded but never stop the walk (cleanup is maximal).
 *
 * The same {@link runCompensations} walk is reused by the executor for an
 * in-process cancellation (Ctrl-C / an aborted `options.signal`).
 *
 * @module
 */

import { type Build, discoverTargets, resolveOrderingEdges } from "./build.ts";
import type { Reporter } from "./executor.ts";
import { type OrderingEdge, planGraph } from "./graph.ts";
import { discoverParameters, resolveParameters } from "./params.ts";
import { Redactor } from "./redact.ts";
import type {
  ForEachSpec,
  JsonValue,
  TargetBuilder,
  TargetContext,
  TargetStateHandle,
} from "./target.ts";
import { absolutePath } from "./path.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import { resolveActor } from "./state/record.ts";
import type {
  RunEvent,
  RunRecord,
  RunStatus,
  SignalRecord,
} from "./state/types.ts";

/** How many times a conflicting cancel CAS is re-read and retried. */
const MAX_RETRIES = 10;

/**
 * A never-aborted signal handed to compensation bodies: the run is already being
 * cancelled, but the cleanup itself must run to completion.
 */
const NEVER_ABORTED: AbortSignal = new AbortController().signal;

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** A message from an unknown thrown value, without casting. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Run `fn`, rejecting if it runs longer than `timeoutMs` (undefined → no bound).
 * A timed-out compensation keeps running in the background but its result is
 * ignored — the same limitation as a target body's `.timeout()`.
 */
function withTimeout(
  fn: () => void | Promise<void>,
  timeoutMs: number | undefined,
): Promise<void> {
  const result = Promise.resolve().then(fn);
  if (timeoutMs === undefined) return result;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    result.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The console reporter cancel prints through when none is supplied. */
const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** A reporter that discards output (for `silent`). */
const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** A run status past which nothing more happens. */
function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" ||
    status === "cancelled";
}

/** An empty compensation outcome (nothing ran, nothing failed). */
const EMPTY_OUTCOME: CompensationOutcome = {
  compensated: [],
  failures: [],
  attempts: [],
};

/** One compensation to run: the target undoing an original, plus that original's meta. */
interface CompensationStep {
  /** The compensation target (its `.executes(...)` body is run). */
  compensation: TargetBuilder;
  /** The name of the succeeded target this compensation undoes. */
  forTarget: string;
  /** The original target's persisted metadata, exposed to the body via `ctx.state`. */
  meta: Record<string, JsonValue>;
}

/** A compensation that threw during the cancel walk (recorded, non-fatal). */
export interface CompensationFailure {
  /** The compensation target that failed. */
  target: string;
  /** The original target whose compensation this was. */
  forTarget: string;
  /** The failure message. */
  error: string;
}

/** One attempted compensation, for the run's audit trail (see {@link compensationEvents}). */
export interface CompensationAttempt {
  /** The succeeded/in-flight target this compensation undid (e.g. a fan-out item `deploy[repo-a].push`). */
  forTarget: string;
  /** The name of the compensation target that ran. */
  compensation: string;
  /** True when the body completed, false when it threw or timed out. */
  ok: boolean;
}

/** What a compensation walk did: which cleanups ran, and which threw. */
export interface CompensationOutcome {
  /** Names of compensation targets whose bodies completed. */
  compensated: string[];
  /** Compensations that threw (the walk continued past each). */
  failures: CompensationFailure[];
  /** Every attempted compensation in run order, for per-target audit events. */
  attempts: CompensationAttempt[];
}

/** Dependencies for {@link runCompensations}. */
export interface CompensationDeps {
  /** The run id, stamped on every compensation's {@link TargetContext}. */
  runId: string;
  /** The run's received signals, exposed to compensation bodies via `ctx.signals`. */
  signals: ReadonlyMap<string, SignalRecord>;
  /** Where the walk narrates its progress. */
  reporter: Reporter;
  /**
   * Masks secrets in a compensation's failure message before it is recorded,
   * returned, or printed — a failed shell command's error can carry a secret in
   * its argv. When absent, messages are used verbatim (no secrets are known).
   */
  redactor?: Redactor;
  /**
   * Extra compensation steps run **before** the reverse-topological walk — used
   * by a timed-out wait whose `onTimeout` names a specific compensation target.
   */
  extra?: CompensationStep[];
}

/** An in-memory {@link TargetStateHandle} seeded with a target's persisted meta. */
function seededStateHandle(seed: Record<string, JsonValue>): TargetStateHandle {
  // A compensation reads the original target's recorded meta; writes stay
  // in-memory (the run is ending, so persisting cleanup state adds no value).
  const meta: Record<string, JsonValue> = { ...seed };
  return {
    get: () => ({ ...meta }),
    set: (patch) => {
      Object.assign(meta, patch);
      return Promise.resolve();
    },
  };
}

/**
 * Run the compensations for a cancelled run: every succeeded target that
 * declared `.onCancel(...)`, in reverse topological order (later successes
 * unwound first). Each compensation body gets a normal {@link TargetContext}
 * whose `state` exposes the original target's persisted metadata. A compensation
 * that throws is recorded and the walk continues. Shared by {@link cancelRun}
 * and the executor's in-process cancellation.
 */
export async function runCompensations(
  order: TargetBuilder[],
  record: RunRecord,
  deps: CompensationDeps,
): Promise<CompensationOutcome> {
  const redact = (message: string): string =>
    deps.redactor ? deps.redactor.redact(message) : message;
  const compensated: string[] = [];
  const failures: CompensationFailure[] = [];
  const attempts: CompensationAttempt[] = [];
  const steps: CompensationStep[] = [...(deps.extra ?? [])];
  // Reverse topological order: undo the work that ran last before the work it
  // was built on.
  for (const t of [...order].reverse()) {
    const name = t.name_ ?? "";
    // A `.forEach(...)` fan-out parent's per-item sub-targets are materialised at
    // run time — they aren't in the static `order`, so the walk can't reach their
    // `.onCancel(...)` directly. Re-materialise the parent and collect each
    // succeeded/in-flight item's own compensation, matched by name against the
    // record. Item compensations run before the parent's own (batch-level) one.
    if (t.forEach_ !== undefined) {
      steps.push(
        ...collectForEachSteps(
          t,
          t.forEach_,
          record,
          failures,
          attempts,
          deps.reporter,
        ),
      );
    }
    if (record.targets[name]?.status !== "succeeded") continue;
    if (t.onCancel_ === undefined) continue;
    // The thunk is user code: a throw here must be recorded, not allowed to
    // escape and wedge the run mid-cancel (cleanup stays maximal).
    let compensation: TargetBuilder | undefined;
    try {
      compensation = t.onCancel_();
    } catch (error) {
      const message = redact(messageOf(error));
      failures.push({
        target: `${name}.onCancel`,
        forTarget: name,
        error: message,
      });
      // Record the resolution failure as an attempt too, so the per-target
      // `compensate` events match the summary event's failed count.
      attempts.push({
        forTarget: name,
        compensation: `${name}.onCancel`,
        ok: false,
      });
      deps.reporter.error(
        `✘ .onCancel() thunk for "${name}" threw: ${message}`,
      );
      continue;
    }
    if (compensation === undefined) {
      deps.reporter.error(
        `cancel: target "${name}" .onCancel() resolved to undefined — ` +
          `skipping. Declare the compensation above "${name}", or pass a thunk.`,
      );
      continue;
    }
    steps.push({
      compensation,
      forTarget: name,
      meta: record.targets[name]?.meta ?? {},
    });
  }

  for (const step of steps) {
    const compName = step.compensation.name_ ??
      `${step.forTarget}.onCancel`;
    const body = step.compensation.fn_;
    if (body === undefined) {
      deps.reporter.info(
        `cancel: compensation "${compName}" for "${step.forTarget}" has no ` +
          `body — skipping.`,
      );
      continue;
    }
    const ctx: TargetContext = {
      runId: deps.runId,
      target: compName,
      signal: NEVER_ABORTED,
      state: seededStateHandle(step.meta),
      // A compensation runs off the durable graph, so only its own seeded state
      // is available; other targets read as empty here.
      stateOf: (t) =>
        t === compName ? seededStateHandle(step.meta) : seededStateHandle({}),
      signals: deps.signals,
      dryRun: false,
    };
    try {
      deps.reporter.info(`↩ compensating ${step.forTarget} → ${compName}`);
      // Honour the compensation's own `.timeout()` so a hung cleanup can't wedge
      // the walk (and leave the record non-terminal); no default, like a body.
      await withTimeout(() => body(ctx), step.compensation.timeout_);
      compensated.push(compName);
      attempts.push({
        forTarget: step.forTarget,
        compensation: compName,
        ok: true,
      });
    } catch (error) {
      const message = redact(messageOf(error));
      failures.push({
        target: compName,
        forTarget: step.forTarget,
        error: message,
      });
      attempts.push({
        forTarget: step.forTarget,
        compensation: compName,
        ok: false,
      });
      deps.reporter.error(`✘ compensation ${compName} failed: ${message}`);
    }
  }
  return { compensated, failures, attempts };
}

/**
 * Collect the per-item compensation steps of a `.forEach(...)` fan-out parent.
 * The sub-targets live on ephemeral builders materialised at run time, so cancel
 * — which may be a fresh process with no live builders — re-runs
 * {@link ForEachSpec.materialize} and matches each stage sub-target **by name**
 * (`parent[key].stage`) against the record. A sub-target that succeeded, or was
 * still in-flight when the cancel landed (an item mid-deploy has partial work to
 * undo), whose re-materialised twin declared `.onCancel(...)`, contributes a
 * step. A stage that is itself a fan-out is recursed into, so nested items'
 * compensations are reached too. Steps come back newest-first so later
 * stages/items unwind before earlier ones. A `materialize()` that throws is
 * recorded as a failure and skipped — never a crash; a record row with no
 * re-materialised twin (a non-deterministic item list) is reported as skipped
 * rather than silently dropped.
 */
function collectForEachSteps(
  parent: TargetBuilder,
  spec: ForEachSpec,
  record: RunRecord,
  failures: CompensationFailure[],
  attempts: CompensationAttempt[],
  reporter: Reporter,
): CompensationStep[] {
  const steps: CompensationStep[] = [];
  const materialised = new Set<string>();
  collectForEachInto(
    parent,
    spec,
    record,
    failures,
    attempts,
    reporter,
    materialised,
    steps,
  );
  // A non-deterministic item list can leave a recorded item with no
  // re-materialised twin: its compensation can't be found. Flag it rather than
  // silently dropping it. Run once, at the top level, against the full set of
  // every descendant sub-target name (so nested items don't false-warn).
  const prefix = `${parent.name_ ?? ""}[`;
  for (const [rowName, row] of Object.entries(record.targets)) {
    if (!rowName.startsWith(prefix) || materialised.has(rowName)) continue;
    if (!isItemCompensable(row.status)) continue;
    reporter.error(
      `cancel: fan-out item "${rowName}" has no matching re-materialised item ` +
        `— its compensation is skipped (is the item list deterministic?).`,
    );
  }
  // Reverse once at the top: later stages/items (and nested items) unwind first.
  return steps.reverse();
}

/**
 * Recursive worker for {@link collectForEachSteps}: materialise `parent`, append
 * each eligible item's compensation step to `out` in forward order, recurse into
 * any stage that is itself a fan-out, and register every descendant sub-target
 * name in `materialised`. A resolution failure (materialize or a thunk throwing)
 * is recorded in both `failures` and `attempts` so the audit trail stays
 * consistent, and never escapes.
 */
function collectForEachInto(
  parent: TargetBuilder,
  spec: ForEachSpec,
  record: RunRecord,
  failures: CompensationFailure[],
  attempts: CompensationAttempt[],
  reporter: Reporter,
  materialised: Set<string>,
  out: CompensationStep[],
): void {
  const parentName = parent.name_ ?? "";
  let items: ReturnType<ForEachSpec["materialize"]>;
  try {
    items = spec.materialize();
  } catch (error) {
    failures.push({
      target: `${parentName}.forEach`,
      forTarget: parentName,
      error: messageOf(error),
    });
    attempts.push({
      forTarget: parentName,
      compensation: `${parentName}.forEach`,
      ok: false,
    });
    reporter.error(
      `✘ cancel: re-materialising "${parentName}" for per-item ` +
        `compensation threw: ${messageOf(error)}`,
    );
    return;
  }
  for (const { key, stages } of items) {
    for (const [stage, sub] of Object.entries(stages)) {
      const subName = `${parentName}[${key}].${stage}`;
      // Name the sub as the executor does, so a nested fan-out reconstructs its
      // grandchildren under the same `parent[key].stage[innerKey].innerStage`
      // names.
      sub.name_ = subName;
      materialised.add(subName);
      // A stage that is itself a fan-out: recurse so nested items' onCancel runs.
      if (sub.forEach_ !== undefined) {
        collectForEachInto(
          sub,
          sub.forEach_,
          record,
          failures,
          attempts,
          reporter,
          materialised,
          out,
        );
      }
      if (!isItemCompensable(record.targets[subName]?.status)) continue;
      if (sub.onCancel_ === undefined) continue;
      let compensation: TargetBuilder | undefined;
      try {
        compensation = sub.onCancel_();
      } catch (error) {
        failures.push({
          target: `${subName}.onCancel`,
          forTarget: subName,
          error: messageOf(error),
        });
        attempts.push({
          forTarget: subName,
          compensation: `${subName}.onCancel`,
          ok: false,
        });
        reporter.error(
          `✘ .onCancel() thunk for "${subName}" threw: ${messageOf(error)}`,
        );
        continue;
      }
      if (compensation === undefined) {
        reporter.error(
          `cancel: fan-out item "${subName}" .onCancel() resolved to ` +
            `undefined — skipping.`,
        );
        continue;
      }
      out.push({
        compensation,
        forTarget: subName,
        meta: record.targets[subName]?.meta ?? {},
      });
    }
  }
}

/**
 * A fan-out item is worth compensating if it succeeded, or was still running
 * when the cancel landed — an item mid-flight may have partial side effects
 * (a started deploy) its `.onCancel(...)` needs to unwind.
 *
 * ponytail: an out-of-process `zuke cancel` compensates a `running` item from a
 * record snapshot, so if that item's body is still live in the owning process
 * (which aborts only on its next state write / lock heartbeat), the compensation
 * can overlap the body's tail. Bodies that checkpoint via `ctx.state.set(...)`
 * or hold a `.lock()` propagate the cancel promptly and close the window; the
 * full fix is prompt abort-propagation in the executor (background run-status
 * poll) — a cancellation-hardening follow-up, out of this milestone's scope.
 */
function isItemCompensable(status: string | undefined): boolean {
  return status === "succeeded" || status === "running";
}

/**
 * Turn a compensation walk's {@link CompensationAttempt}s into audit events
 * (`tool: "compensate"`), one per attempted cleanup, naming the target it undid
 * (e.g. a fan-out item `deploy[repo-a].push`). Appended alongside the summary
 * {@link cancelEvent} so the trail shows each item's outcome, not just a count.
 * Target names are static identifiers, so nothing here needs redaction.
 */
export function compensationEvents(
  attempts: CompensationAttempt[],
  actor: string,
  at: string,
): RunEvent[] {
  return attempts.map((a) => ({
    at,
    tool: "compensate",
    actor,
    outcome: a.ok ? "ok" : "error",
    args: { target: a.forTarget },
    detail: `${a.forTarget} → ${a.compensation}`,
  }));
}

/** Options for {@link cancelRun}. */
export interface CancelOptions {
  /** The id of the run to cancel. */
  runId: string;
  /**
   * Durable store the run lives in. Defaults to the same resolution as a normal
   * run (explicit → `stateStore()` override → env → `.zuke/runs`); cancel always
   * needs one.
   */
  stateStore?: StateStore | false;
  /** Who to attribute the cancellation to in the audit trail. */
  actor?: string;
  /** Reads an environment variable (secrets re-resolve from here for compensations). */
  readEnv?: (name: string) => string | undefined;
  /** Suppress progress output. */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
  /**
   * Extra compensation target names to run first (a timed-out wait whose
   * `onTimeout` names a specific compensation target routes through here).
   */
  also?: string[];
}

/** The outcome of {@link cancelRun}. */
export interface CancelResult {
  /** The run that was cancelled. */
  runId: string;
  /** The run's status after cancelling (`cancelled`, or the terminal status on a no-op). */
  status: RunStatus;
  /** True when the run was already terminal and nothing was done. */
  noop: boolean;
  /** Names of compensation targets whose bodies ran. */
  compensated: string[];
  /** Compensations that threw (recorded, non-fatal). */
  failures: CompensationFailure[];
}

/**
 * Cancel the run `options.runId` for `build`: transition it to `cancelling`
 * (exactly one canceller drives the walk; a live owning process observes the
 * change and aborts), run the compensations of every succeeded target in reverse
 * order, and settle the record as `cancelled`. Idempotent — cancelling an
 * already-terminal run is a friendly no-op.
 *
 * @throws if no state store is configured, or the run does not exist.
 */
export async function cancelRun(
  build: Build,
  options: CancelOptions,
): Promise<CancelResult> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const store = resolveCancelStore(options, build, readEnv);
  if (store === undefined) {
    throw new Error(
      "cancel: no state store is configured. Set ZUKE_STATE_DIR / " +
        "ZUKE_STATE_URL, override stateStore(), or pass one.",
    );
  }
  const runId = options.runId;
  const actor = resolveActor(options.actor, readEnv);
  const reporter = options.reporter ??
    (options.silent ? silentReporter : consoleReporter);
  const now = () => new Date().toISOString();

  const initial = await store.getRun(runId);
  if (initial === null) {
    throw new Error(`cancel: no run "${runId}" found in the store.`);
  }
  if (isTerminal(initial.record.status)) {
    reporter.info(
      `Run ${runId} is already ${initial.record.status}; nothing to cancel.`,
    );
    return {
      runId,
      status: initial.record.status,
      noop: true,
      compensated: [],
      failures: [],
    };
  }

  // Transition running/suspended → cancelling.
  const transitioned = await transitionToCancelling(store, runId, initial, now);
  if (transitioned === "noop") {
    const fresh = await store.getRun(runId);
    const status = fresh?.record.status ?? "cancelled";
    reporter.info(`Run ${runId} is already ${status}; nothing to cancel.`);
    return { runId, status, noop: true, compensated: [], failures: [] };
  }
  if (transitioned === "recover") {
    // The run was left `cancelling` by an interrupted cancellation (a crashed
    // canceller, or a store hiccup mid-finalize). Settle it to `cancelled`
    // without re-running compensations — they may not be idempotent, so a second
    // pass is more dangerous than the small chance an interrupted first pass
    // left some cleanup undone. `zuke cancel` becomes retryable, not a dead end.
    reporter.info(`Run ${runId} was mid-cancellation; finalizing it.`);
    await finalizeCancelled(store, runId, actor, EMPTY_OUTCOME, now);
    return {
      runId,
      status: "cancelled",
      noop: false,
      compensated: [],
      failures: [],
    };
  }
  const record = transitioned.record;

  // Resolve compensation targets by reference, and make `this.<param>.value`
  // available to their bodies (from the record's non-secret params; secrets
  // re-resolve from the environment, exactly as a resume does). Retain the
  // seeded redactor so a compensation's failure message can't leak a secret.
  const targets = discoverTargets(build);
  const params = discoverParameters(build);
  const redactor = new Redactor();
  await resolveParameters(
    params,
    record.params,
    readEnv,
    () => undefined,
    redactor,
  );
  for (const p of params.values()) {
    if (!p.secret_) continue;
    const value = p.stringValue_();
    if (value !== undefined && value !== "") redactor.add(value);
  }

  let outcome: CompensationOutcome = EMPTY_OUTCOME;
  const root = targets.get(record.rootTarget);
  if (root === undefined) {
    reporter.info(
      `cancel: build "${build.constructor.name}" has no target ` +
        `"${record.rootTarget}" — cancelling without compensations.`,
    );
  } else {
    // Honour the build's soft ordering edges (extraEdges + the lazy orderWith
    // provider), exactly as execute() does, so out-of-process cancellation
    // (zuke cancel / MCP / a timed-out wait) compensates in the same
    // reverse-execution order as an in-process cancel. These edges only affect
    // the compensation ORDER, so a failing provider (e.g. an unreachable
    // dependency-graph service during `zuke cancel`) degrades to the base
    // topological order — never abandoning the walk, which would strand the run
    // `cancelling` with its rollbacks never run (a re-cancel then skips them).
    let edges: OrderingEdge[] = [];
    try {
      edges = await resolveOrderingEdges(build, targets);
    } catch (error) {
      reporter.error(
        `cancel: ordering provider failed (${messageOf(error)}); ` +
          `compensating in base topological order.`,
      );
    }
    const order = planGraph(root, edges).order;
    outcome = await runCompensations(order, record, {
      runId,
      signals: new Map(Object.entries(record.signals)),
      reporter,
      redactor,
      extra: resolveExtra(options.also, targets, record),
    });
  }

  await finalizeCancelled(store, runId, actor, outcome, now);
  reporter.info(
    `Run ${runId} cancelled — ${outcome.compensated.length} compensation(s) ` +
      `ran${
        outcome.failures.length > 0 ? `, ${outcome.failures.length} failed` : ""
      }.`,
  );
  return {
    runId,
    status: "cancelled",
    noop: false,
    compensated: outcome.compensated,
    failures: outcome.failures,
  };
}

/** Resolve the store for a cancel — like a run, but always defaulting on. */
function resolveCancelStore(
  options: CancelOptions,
  build: Build,
  readEnv: (name: string) => string | undefined,
): StateStore | undefined {
  return resolveStateStore(options.stateStore, build.stateStore(), {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(".zuke", "runs").path,
    enableDefault: true,
  });
}

/** Resolve `also` target names to compensation steps (timeout `{target}` disposition). */
function resolveExtra(
  also: string[] | undefined,
  targets: Map<string, TargetBuilder>,
  record: RunRecord,
): CompensationStep[] {
  const steps: CompensationStep[] = [];
  for (const name of also ?? []) {
    const target = targets.get(name);
    if (target === undefined) continue;
    steps.push({
      compensation: target,
      forTarget: name,
      meta: record.targets[name]?.meta ?? {},
    });
  }
  return steps;
}

/**
 * Compare-and-swap the run from `running`/`suspended` to `cancelling`. Returns
 * `"noop"` when the run has become terminal, or `"recover"` when it is already
 * `cancelling` — an interrupted cancellation the caller should finalize rather
 * than re-walk.
 */
async function transitionToCancelling(
  store: StateStore,
  id: string,
  initial: { record: RunRecord; version: string },
  now: () => string,
): Promise<{ record: RunRecord; version: string } | "noop" | "recover"> {
  let record = initial.record;
  let version = initial.version;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (isTerminal(record.status)) return "noop";
    if (record.status === "cancelling") return "recover";
    const next = structuredClone(record);
    next.status = "cancelling";
    next.updatedAt = now();
    const result = await store.putRun(next, version);
    if (result.ok) return { record: next, version: result.version };
    const fresh = await store.getRun(id);
    if (fresh === null) return "noop"; // vanished mid-cancel
    record = fresh.record;
    version = fresh.version;
  }
  throw new Error(
    `cancel: gave up cancelling ${id} after repeated conflicts.`,
  );
}

/**
 * CAS the run to `cancelled` and append the cancellation audit event. Throws if
 * it cannot land the write after {@link MAX_RETRIES} conflicts — surfacing a
 * store outage rather than silently leaving the run stuck `cancelling` (a
 * re-`cancel` then recovers it).
 */
async function finalizeCancelled(
  store: StateStore,
  id: string,
  actor: string,
  outcome: CompensationOutcome,
  now: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const loaded = await store.getRun(id);
    if (loaded === null || loaded.record.status === "cancelled") return;
    const at = now();
    const next = structuredClone(loaded.record);
    next.status = "cancelled";
    next.updatedAt = at;
    for (const event of compensationEvents(outcome.attempts, actor, at)) {
      next.events.push(event);
    }
    next.events.push(cancelEvent(actor, outcome, at));
    const result = await store.putRun(next, loaded.version);
    if (result.ok) return;
  }
  throw new Error(
    `cancel: gave up finalizing ${id} to cancelled after repeated conflicts.`,
  );
}

/** Build the audit event summarising a cancellation. Shared with the executor. */
export function cancelEvent(
  actor: string,
  outcome: CompensationOutcome,
  at: string,
): RunEvent {
  const ran = outcome.compensated.length;
  const failed = outcome.failures.length;
  const detail = ran === 0 && failed === 0
    ? "no compensations"
    : `ran ${ran} compensation(s)` +
      (failed > 0 ? `, ${failed} failed` : "");
  return {
    at,
    tool: "cancel",
    actor,
    outcome: failed > 0 ? "error" : "ok",
    args: {},
    detail,
  };
}
