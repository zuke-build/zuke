/**
 * Resume a suspended run — the second half of external-event waits (see
 * `./wait.ts`).
 *
 * {@link resumeRun} takes a build and a run id, transitions the run
 * `suspended → running` with a **compare-and-swap so exactly one resumer wins**
 * (the losers get an {@link AlreadyResumedError}), optionally delivers a signal,
 * verifies the build graph still matches the suspended run, and continues the
 * run through {@link "./executor.ts".execute} — re-running only the targets that
 * had not yet succeeded.
 *
 * A resume is a fresh process: nothing survives from the suspending run except
 * the durable record. Its `ctx.state` and delivered `ctx.signals` are the only
 * things a continuing target can read.
 *
 * @module
 */

import { type Build, type BuildResult, discoverTargets } from "./build.ts";
import { cancelRun } from "./cancel.ts";
import { execute, type Reporter } from "./executor.ts";
import { planGraph } from "./graph.ts";
import type { JsonValue, TargetBuilder } from "./target.ts";
import { absolutePath } from "./path.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import { resolveActor } from "./state/record.ts";
import type {
  RunGraphNode,
  RunRecord,
  WaitDisposition,
  WaitState,
} from "./state/types.ts";

/** Raised when a run has already been resumed by another process. */
export class AlreadyResumedError extends Error {
  /** The error name. */
  override name = "AlreadyResumedError";
  /** Build the error from the run id and who is already running it. */
  constructor(
    /** The run that could not be resumed. */
    readonly runId: string,
    /** The actor already running it. */
    readonly by: string,
    /** ISO-8601 time it went `running`. */
    readonly at: string,
  ) {
    super(`run ${runId} was already resumed by ${by} at ${at}`);
  }
}

/** Options for {@link resumeRun}. */
export interface ResumeOptions {
  /** The id of the suspended run to resume. */
  runId: string;
  /**
   * Durable store the run lives in. Defaults to the same resolution as a normal
   * run (explicit → `stateStore()` override → env → `.zuke/runs`); resume always
   * needs one.
   */
  stateStore?: StateStore | false;
  /** Deliver a signal by this name before resuming (satisfies `externalSignal`). */
  signal?: string;
  /** The signal's JSON payload (defaults to `{}`); ignored without {@link signal}. */
  data?: JsonValue;
  /** Non-secret parameter overrides; the rest come from the record. */
  params?: Record<string, string>;
  /** Reads an environment variable (secrets re-resolve from here). */
  readEnv?: (name: string) => string | undefined;
  /** Who to attribute the resumption to (stamped on the run). */
  actor?: string;
  /** Continue even if the build graph changed since the run was suspended. */
  forceGraph?: boolean;
  /** Suppress banner/summary output. */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
}

/** How many times a conflicting resume CAS is re-read and retried. */
const MAX_RETRIES = 10;

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * Resume the suspended run `options.runId` for `build`. Transitions it to
 * `running` (exactly one resumer wins), optionally delivers a signal, checks the
 * graph still matches, and continues via {@link "./executor.ts".execute},
 * re-running only the not-yet-succeeded targets.
 *
 * @throws {AlreadyResumedError} if another process already resumed it.
 * @throws if the run does not exist, is not suspended, the build lacks its root
 *   target, or the graph drifted (unless {@link ResumeOptions.forceGraph}).
 */
export async function resumeRun(
  build: Build,
  options: ResumeOptions,
): Promise<BuildResult> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const store = resolveResumeStore(options, build, readEnv);
  if (store === undefined) {
    throw new Error(
      "resume: no state store is configured. Set ZUKE_STATE_DIR / " +
        "ZUKE_STATE_URL, override stateStore(), or pass one.",
    );
  }

  const initial = await store.getRun(options.runId);
  if (initial === null) {
    throw new Error(`resume: no run "${options.runId}" found in the store.`);
  }

  const resumerActor = resolveActor(options.actor, readEnv);
  const now = () => new Date().toISOString();

  // A wait past its deadline times out instead of resuming, honouring its
  // recorded onTimeout disposition: "fail" fails the run; "cancel-run" and a
  // named compensation target both cancel the run (running its compensations).
  const expired = expiredWait(initial.record, Date.now());
  if (initial.record.status === "suspended" && expired !== null) {
    const disposition = expired.waitingFor.onTimeout;
    if (disposition === "fail") {
      return await failTimedOut(store, initial, expired, now);
    }
    return await cancelTimedOut(
      build,
      store,
      options,
      expired,
      disposition,
      resumerActor,
      readEnv,
    );
  }
  // Validate the root and graph shape *before* transitioning, so a mismatch
  // leaves the run suspended (retryable with --force-graph) rather than stuck.
  const targets = discoverTargets(build);
  const root = targets.get(initial.record.rootTarget);
  if (root === undefined) {
    throw new Error(
      `resume: build "${build.constructor.name}" has no target ` +
        `"${initial.record.rootTarget}" — cannot resume run ${options.runId}.`,
    );
  }
  if (options.forceGraph !== true) {
    assertGraphUnchanged(
      options.runId,
      planGraph(root).order,
      initial.record.graph,
    );
  }

  // Transition suspended → running (exactly one resumer wins).
  const { record, version } = await transitionToRunning(
    store,
    options.runId,
    initial,
    resumerActor,
    now,
    options.signal,
    options.data ?? {},
  );

  // Targets recorded `succeeded` do not re-run; everything else does.
  const done = new Set(
    Object.entries(record.targets)
      .filter(([, state]) => state.status === "succeeded")
      .map(([name]) => name),
  );

  return await execute(build, root, {
    stateStore: store,
    params: { ...record.params, ...(options.params ?? {}) },
    readEnv,
    actor: resumerActor,
    silent: options.silent,
    reporter: options.reporter,
    resume: { record, version, done },
  });
}

/** Resolve the store for a resume — like a normal run, but always defaulting on. */
function resolveResumeStore(
  options: ResumeOptions,
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

/**
 * Compare-and-swap the run from `suspended` to `running`, appending a signal if
 * given. The loser of the race — who finds it already `running` — gets an
 * {@link AlreadyResumedError}.
 */
async function transitionToRunning(
  store: StateStore,
  id: string,
  initial: { record: RunRecord; version: string },
  resumerActor: string,
  now: () => string,
  signal: string | undefined,
  data: JsonValue,
): Promise<{ record: RunRecord; version: string }> {
  let record = initial.record;
  let version = initial.version;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (record.status !== "suspended") {
      if (record.status === "running") {
        throw new AlreadyResumedError(id, record.actor, record.updatedAt);
      }
      throw new Error(
        `resume: run ${id} is "${record.status}", not suspended.`,
      );
    }
    const next = structuredClone(record);
    next.status = "running";
    next.actor = resumerActor;
    next.updatedAt = now();
    if (signal !== undefined) {
      next.signals[signal] = { data, receivedAt: now() };
    }
    const result = await store.putRun(next, version);
    if (result.ok) return { record: next, version: result.version };
    // Someone else moved it: re-read and re-check (they may have won the race).
    const fresh = await store.getRun(id);
    if (fresh === null) {
      throw new Error(`resume: run ${id} vanished mid-resume.`);
    }
    record = fresh.record;
    version = fresh.version;
  }
  throw new Error(`resume: gave up resuming ${id} after repeated conflicts.`);
}

/** Fail with a descriptive error if the current graph differs from the record's. */
function assertGraphUnchanged(
  id: string,
  order: TargetBuilder[],
  snapshot: RunGraphNode[],
): void {
  const current: RunGraphNode[] = order.map((t) => ({
    name: t.name_ ?? "",
    dependsOn: t.dependsOn_.map((d) => d.name_ ?? "").filter((n) => n !== ""),
  }));
  const drift = graphDrift(snapshot, current);
  if (drift.length > 0) {
    throw new Error(
      `resume: the build graph changed since run ${id} was suspended ` +
        `(${drift.join("; ")}). Re-run with --force-graph to override.`,
    );
  }
}

/** The differences between a recorded graph snapshot and the current one. */
function graphDrift(
  snapshot: RunGraphNode[],
  current: RunGraphNode[],
): string[] {
  const drift: string[] = [];
  const snap = new Map(snapshot.map((n) => [n.name, n.dependsOn]));
  const cur = new Map(current.map((n) => [n.name, n.dependsOn]));
  for (const name of snap.keys()) {
    if (!cur.has(name)) drift.push(`removed "${name}"`);
  }
  for (const [name, deps] of cur) {
    const before = snap.get(name);
    if (before === undefined) drift.push(`added "${name}"`);
    else if (!sameMembers(before, deps)) drift.push(`re-wired "${name}"`);
  }
  return drift;
}

/** Whether two string lists have the same members (order-insensitive). */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** The first waiting target whose deadline has passed, or `null`. */
function expiredWait(
  record: RunRecord,
  nowMs: number,
): { name: string; waitingFor: WaitState } | null {
  for (const [name, state] of Object.entries(record.targets)) {
    const deadline = state.waitingFor?.deadline;
    if (
      state.status === "waiting" && state.waitingFor !== undefined &&
      deadline !== undefined && Date.parse(deadline) <= nowMs
    ) {
      return { name, waitingFor: state.waitingFor };
    }
  }
  return null;
}

/**
 * Mark a timed-out wait's target `failed` and the run `failed` (CAS-retry), and
 * return a failing result. The onTimeout disposition is left recorded for the
 * cancellation milestone to act on.
 */
async function failTimedOut(
  store: StateStore,
  initial: { record: RunRecord; version: string },
  expired: { name: string; waitingFor: WaitState },
  now: () => string,
): Promise<BuildResult> {
  let record = initial.record;
  let version = initial.version;
  const message = `wait "${expired.name}" timed out (deadline ` +
    `${expired.waitingFor.deadline})`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (record.status !== "suspended") break; // someone else moved it on
    const next = structuredClone(record);
    const target = next.targets[expired.name];
    if (target !== undefined) {
      target.status = "failed";
      target.error = message;
      target.endedAt = now();
    }
    next.status = "failed";
    next.updatedAt = now();
    const result = await store.putRun(next, version);
    if (result.ok) break;
    const fresh = await store.getRun(record.id);
    if (fresh === null) break;
    record = fresh.record;
    version = fresh.version;
  }
  return {
    ok: false,
    executed: [],
    error: new Error(`resume: run ${record.id}: ${message}.`),
  };
}

/**
 * Handle a timed-out wait whose disposition **cancels** the run: `"cancel-run"`
 * cancels it (running the compensations of every succeeded target), and a named
 * target additionally runs that specific compensation first. Delegates to
 * {@link "./cancel.ts".cancelRun}, so a stuck deploy → wait → (timeout) is
 * unwound and its locks released — the failure mode a bare timeout can't fix.
 */
async function cancelTimedOut(
  build: Build,
  store: StateStore,
  options: ResumeOptions,
  expired: { name: string; waitingFor: WaitState },
  disposition: WaitDisposition,
  actor: string,
  readEnv: (name: string) => string | undefined,
): Promise<BuildResult> {
  const also = typeof disposition === "object"
    ? [disposition.target]
    : undefined;
  const result = await cancelRun(build, {
    runId: options.runId,
    stateStore: store,
    actor,
    readEnv,
    silent: options.silent,
    reporter: options.reporter,
    also,
  });
  return {
    ok: false,
    executed: [],
    cancelled: true,
    runId: options.runId,
    error: new Error(
      `resume: run ${options.runId}: wait "${expired.name}" timed out ` +
        `(deadline ${expired.waitingFor.deadline}) — run cancelled ` +
        `(${result.compensated.length} compensation(s) ran).`,
    ),
  };
}

/**
 * Re-attempt every suspended run in the store (or just `runId`): predicate-based
 * waits are re-evaluated and expired waits time out. Signal-based waits with no
 * new signal simply re-suspend. Returns the number of runs that ended in
 * failure. This is the sweep a cron or webhook drives (`zuke resume --check`).
 */
export async function resumeCheck(
  build: Build,
  options: Omit<ResumeOptions, "runId" | "signal" | "data"> & {
    runId?: string;
  },
): Promise<{ checked: number; failed: number }> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const store = resolveResumeStore({ ...options, runId: "" }, build, readEnv);
  if (store === undefined) {
    throw new Error("resume --check: no state store is configured.");
  }
  const ids = options.runId !== undefined
    ? [options.runId]
    : (await store.listRuns({ status: "suspended" })).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await resumeRun(build, { ...options, runId: id });
      if (!result.ok) failed += 1;
    } catch (error) {
      if (error instanceof AlreadyResumedError) continue; // another process has it
      // Isolate a per-run failure: one run erroring (a bad graph, a throwing
      // compensation) must not abort the sweep and strand every run behind it.
      failed += 1;
      options.reporter?.error(
        `resume --check: run ${id} errored: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { checked: ids.length, failed };
}
