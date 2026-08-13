// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The execution engine: running one target (conditions, cache, service, wait
 * gate, lock, body with timeout/retry/remediation) and the two schedulers that
 * drive a plan — the simple sequential loop and the dependency-aware concurrent
 * scheduler. `runTarget`, `runForEachTarget` and `runScheduled` are mutually
 * recursive (a fan-out target runs a nested schedule), so they live together.
 * All state is bundled in a {@link RunContext}; {@link "./executor.ts".execute}
 * builds it and calls {@link runSequential}/{@link runScheduled}.
 *
 * @module
 */

import { delay, messageOf, runWithTimeout } from "./internal.ts";
import { bufferReporter, type Reporter } from "./reporter.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { acquireTargetLock, type HeldLock } from "./lock.ts";
import { resolveWait, type WaitResolution } from "./wait_resolution.ts";
import {
  errorMessage,
  outcomeView,
  type RunEnv,
  type RunOutcome,
  type TargetOutcome,
} from "./run_support.ts";
import { withAmbientEcho } from "./ambient_echo.ts";
import { type Style, type TargetReport, targetWaitFooter } from "./report.ts";
import type { Renderer } from "./renderer.ts";
import {
  cloneTarget,
  type EffectContext,
  type ForEachItem,
  ForEachSettings,
  type ForEachSpec,
  type Remediation,
  type TargetBuilder,
  type TargetContext,
  type TargetOutcomeView,
} from "./target.ts";
import type { BuildCache } from "./cache.ts";
import { ServiceBuilder, type ServiceRegistry } from "./service.ts";
import { inMemoryStateHandle } from "./state/writer.ts";
import { recordStatusOf } from "./state/record.ts";
import type { TargetStatus } from "./build.ts";

/**
 * Open a target's section — a collapsible group under GitHub Actions, or a
 * ruled header in a terminal, separated from the previous block by a blank
 * line.
 */
function openTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  opened: number,
): void {
  if (!style.github && opened > 0) r.info("");
  for (const line of renderer.targetHeader(style, name)) r.info(line);
}

/** Close a target's section after it succeeded. */
function passTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  ms: number,
): void {
  for (const line of renderer.targetPassFooter(style, name, ms)) r.info(line);
}

/** Close a target's section after it failed and surface the error. */
function failTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  ms: number,
  error: unknown,
): void {
  const { info, error: err } = renderer.targetFailFooter(
    style,
    name,
    ms,
    error,
  );
  for (const line of info) r.info(line);
  for (const line of err) r.error(line);
}

/**
 * The immutable per-run values threaded to every scheduler and target: the
 * {@link Lifecycle}, the output {@link Reporter}/{@link Renderer}/{@link Style},
 * the incremental {@link BuildCache} (if any), the `dryRun` flag, the build-level
 * remediations, the {@link ServiceRegistry}, and the {@link RunEnv}. Bundling
 * them replaces the 11- and 14-argument positional signatures the scheduler
 * functions used to carry (guideline 9); each reads the fields it needs.
 */
export interface RunContext {
  /** The composed build+plugins lifecycle. */
  life: Lifecycle;
  /** The output sink for framework lines. */
  reporter: Reporter;
  /** The renderer producing the framework's line output. */
  renderer: Renderer;
  /** The resolved output style (color, GitHub grouping, …). */
  style: Style;
  /** The incremental cache, or `undefined` when disabled/absent. */
  cache: BuildCache | undefined;
  /** Whether this is a dry run (no bodies execute, no cache/state writes). */
  dryRun: boolean;
  /** Build-level remediations applied after each target's own. */
  globalRecovery: Remediation[];
  /** The registry of services started during the run. */
  services: ServiceRegistry;
  /** The per-run env (id, signal, writer, store, …). */
  env: RunEnv;
}

/**
 * Run a target body, applying its {@link TargetBuilder.timeout} and
 * {@link TargetBuilder.retry} settings: each attempt is bounded by the timeout,
 * and a failure is retried (after an optional delay) up to the retry count
 * before the last error propagates.
 */
async function runBody(t: TargetBuilder, ctx: TargetContext): Promise<void> {
  const fn = t.fn_;
  if (fn === undefined) return; // guarded by the caller
  const attempts = t.retries_ + 1;
  for (let attempt = 1;; attempt++) {
    try {
      await runWithTimeout(() => fn(ctx), t.timeout_);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      // A cancelled run (Ctrl-C / SIGTERM / an aborted signal) must not burn
      // further retries: surface the failure now instead of re-running the body.
      if (ctx.signal.aborted) throw error;
      if (t.retryDelay_ > 0) await delay(t.retryDelay_);
    }
  }
}

/**
 * Run the target body, and if it fails, hand the failure to each configured
 * {@link TargetBuilder.recoverWith} remediation in turn. When any remediation
 * asks to retry, the body is re-run; this repeats up to
 * {@link TargetBuilder.recoverAttempts} times. The body finally passing resolves
 * normally; otherwise the last failure propagates. A remediation that throws is
 * treated as "could not heal" — it never masks the original build failure.
 */
async function runBodyWithRecovery(
  t: TargetBuilder,
  name: string,
  globalRecovery: Remediation[],
  ctx: TargetContext,
): Promise<void> {
  try {
    await runBody(t, ctx);
    return;
  } catch (error) {
    // A target's own remediations run first, then any build-level ones.
    const remediations = [...t.recoverWith_, ...globalRecovery];
    if (remediations.length === 0) throw error;
    let lastError = error;
    for (let attempt = 1; attempt <= t.recoverAttempts_; attempt++) {
      // A cancelled run must not trigger (possibly paid) remediations: stop and
      // let the original failure propagate (falls through to `throw lastError`).
      if (ctx.signal.aborted) break;
      let willRetry = false;
      for (const r of remediations) {
        try {
          const result = await r.remediate({
            target: name,
            attempt,
            error: lastError,
          });
          if (result.retry) willRetry = true;
        } catch {
          // A throwing remediation counts as "could not heal"; keep the build
          // error intact rather than surfacing the remediation's own failure.
        }
      }
      if (!willRetry) break;
      try {
        await runBody(t, ctx);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
}

/**
 * Build the {@link TargetContext} a target's body and effects receive.
 *
 * Shared rather than inlined because two paths need it: the ordinary body, and a
 * `.waitsFor(...)` gate whose trigger is already satisfied — that gate returns
 * early, and its effects are owed at exactly that moment.
 */
function targetContextFor(
  name: string,
  env: RunEnv,
  dryRun: boolean,
): TargetContext {
  // One own-state handle, reused for `stateOf(this target)` so the documented
  // `stateOf(self) === state` invariant holds even store-less (a fresh
  // inMemoryStateHandle per call would drop writes).
  const ownState = env.writer
    ? env.writer.stateHandle(name)
    : inMemoryStateHandle();
  return {
    runId: env.runId,
    target: name,
    signal: env.signal,
    state: ownState,
    stateOf: (t) =>
      t === name
        ? ownState
        : (env.writer ? env.writer.stateHandle(t) : inMemoryStateHandle()),
    outcomeOf: (t) => outcomeOf(env, t),
    outcomes: () => allOutcomes(env),
    signals: env.signals,
    dryRun,
  };
}

/**
 * Drive a target's declared effects, each behind a durable intent.
 *
 * The order is the whole feature: the intent is written and confirmed *before*
 * the body runs, so a process killed anywhere inside the body leaves a
 * `pending` row saying the effect was owed. A resume, or the sweep, drives it
 * again from there.
 *
 * An effect already recorded `done` is skipped rather than repeated — the no-op
 * that makes re-driving a completed effect free. A failure is recorded and then
 * re-thrown, so the target fails and the run reports it; the row stays `failed`
 * and a later attempt re-arms it.
 *
 * A write that cannot land throws out of here **without** the body having run,
 * which is the fail-closed half: no durable intent, no side effect.
 *
 * Not driven at all when the target does not run: an `onlyWhen` condition that
 * fails skips the target, and a skipped target's effects are not owed. Every
 * *other* path that reaches a target's real execution drives them — including a
 * `.waitsFor(...)` gate whose trigger is already satisfied, and a target that
 * would otherwise have been served from the cache (declaring an effect takes a
 * target out of the cache for exactly that reason). A service and a fan-out run no
 * body of their own, so they refuse `.effect()` outright rather than silently
 * dropping it.
 */
async function driveEffects(
  t: TargetBuilder,
  name: string,
  ctx: TargetContext,
  env: RunEnv,
  reporter: Reporter,
): Promise<void> {
  if (t.effects_.length === 0) return;
  const writer = env.writer;
  if (writer === undefined) {
    // Unreachable in practice: a build that declares effects turns the state
    // store on, and one with state explicitly disabled is refused before the
    // run starts (see openRunState). Guarded anyway rather than silently
    // running an effect with nothing recording it.
    throw new Error(
      `Target "${name}" declares an effect, which needs a state store to ` +
        `record its intent — but this run has none.`,
    );
  }
  for (const declared of t.effects_) {
    const gate = await writer.beginEffect(name, declared.name);
    if (gate === "skip") continue;
    const attempts = writer.snapshot().targets[name]?.effects?.[declared.name]
      ?.attempts ?? 1;
    const effectCtx: EffectContext = {
      ...ctx,
      effect: declared.name,
      redriven: attempts > 1,
    };
    try {
      await declared.fn(effectCtx);
    } catch (error) {
      // Recording the failure must not replace it. If this write is itself
      // refused — the run cancelled elsewhere, or too many conflicting writes —
      // the caller would otherwise see a message about bookkeeping instead of
      // the API error that actually happened, which is the one thing anyone
      // reading the incident needs.
      try {
        await writer.markEffectSettled(
          name,
          declared.name,
          false,
          messageOf(error),
        );
      } catch (settleError) {
        reporter.info(
          `effect "${declared.name}" on "${name}" failed, and recording that ` +
            `failed too: ${messageOf(settleError)}`,
        );
      }
      throw error;
    }
    await writer.markEffectSettled(name, declared.name, true);
  }
}

/**
 * What one target in this run did, for `ctx.outcomeOf(...)`.
 *
 * This process's own map answers first, and the durable record only fills in
 * what that map has never seen. The order matters and is not an optimisation:
 * the map is written the instant a target settles, while the record's write is
 * queued behind every other pending write — so between a failure and its write
 * landing, the record still says `running`. Reading the record first would let
 * an aggregating gate call a failed run green, which is the exact outcome the
 * durable-effects work exists to prevent. The record's turn comes for targets
 * this process never ran: after a resume, everything an earlier process
 * settled.
 */
function outcomeOf(
  env: RunEnv,
  target: string,
): TargetOutcomeView | undefined {
  const live = env.statuses.get(target);
  const row = env.writer?.snapshot().targets[target];
  if (live === undefined) {
    if (row === undefined || row.status === "pending") return undefined;
    return outcomeView({ status: row.status }, row);
  }
  return outcomeView(live, row);
}

/** Every settled outcome in this run, this process's map over the record's. */
function allOutcomes(env: RunEnv): ReadonlyMap<string, TargetOutcomeView> {
  const all = new Map<string, TargetOutcomeView>();
  const rows = env.writer?.snapshot().targets ?? {};
  for (const [name, row] of Object.entries(rows)) {
    if (row.status === "pending") continue; // no outcome yet, so not an entry
    all.set(name, outcomeView({ status: row.status }, row));
  }
  for (const [name, settled] of env.statuses) {
    all.set(name, outcomeView(settled, rows[name]));
  }
  return all;
}

/**
 * Run one target: honour its `onlyWhen` conditions and the incremental cache,
 * then (if it must run) open its section, run its body, and report pass/fail.
 * A condition that fails yields `skipped`; an up-to-date target yields `cached`
 * — both unblock dependents without executing the body. With `dryRun`, a target
 * that would run is reported without executing its body or touching the cache.
 */
async function runTarget(
  ctx: RunContext,
  t: TargetBuilder,
  opened: number,
): Promise<TargetOutcome> {
  const { life, reporter, renderer, style, cache, dryRun, globalRecovery } =
    ctx;
  const { services, env } = ctx;
  const name = t.name_ ?? "<unnamed>";

  for (const condition of t.onlyWhen_) {
    if (!(await condition())) return { status: "skipped", ms: 0 };
  }

  const missing = t.requires_.filter((p) => !p.isSet_());
  if (missing.length > 0) {
    const names = missing.map((p) => `"${p.name_ ?? "(unnamed)"}"`).join(", ");
    const error = new Error(
      `Target "${name}" requires parameter(s) that are not set: ${names}.`,
    );
    openTarget(reporter, renderer, style, name, opened);
    failTarget(reporter, renderer, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  if (dryRun) {
    openTarget(reporter, renderer, style, name, opened);
    // A `.dryRunnable()` target with a body runs it with `$` in echo mode
    // instead of being skipped, to preview the exact commands a real run would
    // execute. State is in-memory only (a dry run persists nothing), and no lock
    // or cache is taken.
    if (t.dryRunnable_ && t.fn_ !== undefined) {
      const echoState = inMemoryStateHandle();
      const targetCtx: TargetContext = {
        runId: env.runId,
        target: name,
        signal: env.signal,
        state: echoState,
        stateOf: (t2) => t2 === name ? echoState : inMemoryStateHandle(),
        outcomeOf: (t2) => outcomeOf(env, t2),
        outcomes: () => allOutcomes(env),
        signals: env.signals,
        dryRun: true,
      };
      const start = performance.now();
      try {
        await withAmbientEcho(
          (line) => reporter.info(`  $ ${line}`),
          () => runBody(t, targetCtx),
        );
        const ms = performance.now() - start;
        passTarget(reporter, renderer, style, name, ms);
        return { status: "passed", ms };
      } catch (error) {
        const ms = performance.now() - start;
        failTarget(reporter, renderer, style, name, ms, error);
        return { status: "failed", ms, error };
      }
    }
    for (const line of renderer.targetDryRunFooter(style, name)) {
      reporter.info(line);
    }
    return { status: "passed", ms: 0 };
  }

  // A service starts a long-lived process and stays up while its dependents
  // run; the registry stops it during teardown. It has no cacheable body and no
  // `.executes` — so it is handled before the cache and body paths below.
  if (t instanceof ServiceBuilder) {
    openTarget(reporter, renderer, style, name, opened);
    await life.targetStart(name);
    void env.writer?.markTargetRunning(name);
    const start = performance.now();
    try {
      services.register(await t.launch_(name));
      const ms = performance.now() - start;
      passTarget(reporter, renderer, style, name, ms);
      return { status: "passed", ms };
    } catch (error) {
      const ms = performance.now() - start;
      failTarget(reporter, renderer, style, name, ms, error);
      return { status: "failed", ms, error };
    }
  }

  // A `.forEach(...)` target fans out into a per-item pipeline of sub-targets,
  // driven by a nested scheduler. It has no body of its own, so it is handled
  // before the cache and body paths (like a service).
  if (t.forEach_ !== undefined) {
    return await runForEachTarget(ctx, t, t.forEach_, opened);
  }

  if (cache !== undefined && await cache.upToDate(t)) {
    return { status: "cached", ms: 0 };
  }

  // A `.waitsFor(...)` target is a gate, not a body: if its trigger is already
  // satisfied it passes (dependents run); otherwise the run suspends here.
  if (t.waitsFor_ !== undefined) {
    openTarget(reporter, renderer, style, name, opened);
    let wait: WaitResolution;
    try {
      wait = await resolveWait(t.waitsFor_, env, name);
    } catch (error) {
      failTarget(reporter, renderer, style, name, 0, error);
      return { status: "failed", ms: 0, error };
    }
    if (wait.satisfied) {
      // The gate has opened, so this is the target's real run and its effects
      // are owed now. Returning here without driving them would drop them
      // silently — the run reports success and nothing records the effect was
      // ever due.
      try {
        await driveEffects(
          t,
          name,
          targetContextFor(name, env, dryRun),
          env,
          reporter,
        );
      } catch (error) {
        failTarget(reporter, renderer, style, name, 0, error);
        return { status: "failed", ms: 0, error };
      }
      passTarget(reporter, renderer, style, name, 0);
      return { status: "passed", ms: 0 };
    }
    env.statuses.set(name, { status: "waiting" });
    void env.writer?.markTargetWaiting(name, wait.waitState);
    for (const line of targetWaitFooter(style, name, wait.descriptor)) {
      reporter.info(line);
    }
    return { status: "waiting", ms: 0 };
  }

  openTarget(reporter, renderer, style, name, opened);
  await life.targetStart(name);
  void env.writer?.markTargetRunning(name);
  const start = performance.now();

  if (!t.fn_ && t.effects_.length === 0) {
    const error = new Error(
      `Target "${name}" has no body — call .executes(...) before running.`,
    );
    failTarget(reporter, renderer, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  const targetCtx = targetContextFor(name, env, dryRun);

  // Acquire the target's cross-run lock (if any) before the body. A conflict —
  // or a lock declared with no store — fails the target with the guidance.
  let lock: HeldLock | null;
  try {
    lock = await acquireTargetLock(t, env);
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  }

  try {
    for (const v of t.validateBefore_) await v.validate({ target: name });
    await runBodyWithRecovery(t, name, globalRecovery, targetCtx);
    await driveEffects(t, name, targetCtx, env, reporter);
    for (const v of t.validateAfter_) await v.validate({ target: name });
    const ms = performance.now() - start;
    if (cache !== undefined) await cache.record(t);
    passTarget(reporter, renderer, style, name, ms);
    return { status: "passed", ms };
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  } finally {
    // Release on every path — success, failure, cancellation. The TTL is only
    // the backstop for a killed process.
    if (lock !== null) await lock.release();
  }
}

/**
 * Run a `.forEach(...)` fan-out target: materialise a pipeline of sub-targets
 * per item (named `parent[key].stage`, each stage depending on the previous),
 * then drive them all with the shared {@link runScheduled} machinery — items
 * concurrent up to the configured limit, each item's stages sequential. With
 * `continueOnItemFailure`, sub-targets are lenient so a failed item does not
 * halt its siblings; the fan-out target still fails if any item did. The
 * sub-targets' reports come back as {@link TargetOutcome.children} for the
 * summary, and each is recorded in the run's state under its own name.
 */
async function runForEachTarget(
  ctx: RunContext,
  t: TargetBuilder,
  spec: ForEachSpec,
  opened: number,
): Promise<TargetOutcome> {
  const { life, reporter, renderer, style, env } = ctx;
  const name = t.name_ ?? "<unnamed>";
  const settings = spec.configure
    ? spec.configure(new ForEachSettings())
    : new ForEachSettings();
  openTarget(reporter, renderer, style, name, opened);
  await life.targetStart(name);
  void env.writer?.markTargetRunning(name);
  const start = performance.now();

  // Materialise each item's stages into named, chained sub-targets. The items
  // thunk and factory are user code (they read params and build targets), so a
  // throw here must fail the fan-out target cleanly — not escape as an uncaught
  // rejection that crashes the run and leaves the record non-terminal.
  const order: TargetBuilder[] = [];
  const predecessors = new Map<TargetBuilder, TargetBuilder[]>();
  let items: ForEachItem[];
  try {
    items = spec.materialize();
    for (const { key, stages } of items) {
      let prev: TargetBuilder | undefined;
      for (const [stage, declared] of Object.entries(stages)) {
        // Work on a clone: the factory may hand back the same builder for every
        // item (or on every run of a long-lived process), and renaming/chaining
        // it in place would corrupt that object and pile up duplicate edges.
        const sub = cloneTarget(declared);
        sub.name_ = `${name}[${key}].${stage}`;
        // Isolating item failures means a failed stage stays lenient: its
        // siblings keep running, only this item's later stages are blocked.
        if (settings.continueOnItemFailure_) sub.proceedAfterFailure_ = true;
        const deps = prev === undefined ? [] : [prev];
        if (prev !== undefined) sub.dependsOn_.push(prev);
        order.push(sub);
        predecessors.set(sub, deps);
        prev = sub;
      }
    }
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  }
  reporter.info(
    items.length === 0
      ? `${name}: fan-out over 0 items — nothing to run.`
      : `${name}: fan-out over ${items.length} item(s).`,
  );
  const run = await runScheduled(
    ctx,
    order,
    predecessors,
    new Set(),
    settings.concurrency_ ?? cpuCount(),
    () => true, // items and stages overlap; predecessors enforce per-item order
  );
  const ms = performance.now() - start;
  // Only `aborted` (a failed sub-target) is possible here — never `suspended`. A
  // fan-out sub-target can't carry a `.waitsFor()` gate (rejected at materialise
  // above), so no stage can end "waiting"; `run.suspended` is therefore always
  // false. Were a suspend to slip through it would be swallowed (the parent would
  // report "passed" while the row stayed durably "waiting"), which the materialise
  // guard exists to prevent.
  if (run.aborted) {
    const failed = run.reports.filter((r) => r.status === "failed").length;
    const error = run.failure ??
      new Error(`${name}: ${failed} sub-target(s) failed.`);
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error, children: run.reports };
  }
  // A cancellation is not a success, and here it has to be said explicitly. The
  // nested scheduler reports `aborted` only when a sub-target *failed*, and a
  // cancelled run's remaining items are abandoned rather than failed — so
  // nothing would mark the fan-out, and the parent would report `passed` for a
  // batch whose items never ran. The top-level scheduler is saved from the same
  // reasoning by `execute`, which overrides its outcome with the run's
  // cancellation; a nested one has no such reader. Getting this wrong is not
  // cosmetic: the parent's row is written `succeeded`, and the compensation walk
  // undoes exactly the targets the record calls succeeded — so a rollback would
  // run against a deployment that never happened.
  if (ctx.env.signal.aborted) {
    const error = new Error(`${name}: cancelled before its items finished.`);
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error, children: run.reports };
  }
  passTarget(reporter, renderer, style, name, ms);
  return { status: "passed", ms, children: run.reports };
}

/** Resolve the concurrency limit; 1 means sequential. */
export function resolveConcurrency(
  option: boolean | number | undefined,
): number {
  if (option === undefined || option === false) return 1;
  if (option === true) return cpuCount();
  return option > 1 ? Math.floor(option) : 1;
}

/** The host's CPU count, used as the default parallel/batch concurrency. */
export function cpuCount(): number {
  const cpus = navigator.hardwareConcurrency;
  return cpus > 0 ? cpus : 4;
}

/**
 * Record a target's terminal status — synchronously for this process, and
 * durably through the writer.
 *
 * Both halves, always, and in that order. The durable write is fire-and-forget
 * through the writer's serialized chain, so between a target failing and its
 * write landing the record still says `running`; a gate reading outcomes in
 * that window would aggregate a failure as though it had not happened yet. The
 * in-memory map closes that window, and the record is what carries the same
 * facts across a process boundary.
 */
function settleTarget(
  env: RunEnv,
  name: string,
  status: TargetStatus,
  error?: string,
): void {
  env.statuses.set(name, { status: recordStatusOf(status), error });
  void env.writer?.markTargetSettled(name, status, error);
}

/** Sequentially run the plan, aborting (and skipping the rest) on first failure. */
export async function runSequential(
  ctx: RunContext,
  order: TargetBuilder[],
  skip: Set<string>,
): Promise<RunOutcome> {
  const { life, reporter, renderer, style, env } = ctx;
  const reports: TargetReport[] = [];
  const executed: string[] = [];
  let failure: unknown;
  let aborted = false;
  let opened = 0;

  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    // A cancelled run stops *launching*, not just retrying. Usually the running
    // target fails first (its shell is terminated) and `aborted` covers the
    // rest, but a body that finishes anyway — or a run cancelled before the
    // first target — would otherwise keep starting new work after the run has
    // demonstrably stopped being this process's to do. That matters most when
    // the cancellation is a lost lease: the new holder is already running these
    // very targets.
    if (skip.has(name) || aborted || env.signal.aborted) {
      reports.push({ name, status: "skipped", ms: 0 });
      settleTarget(env, name, "skipped");
      continue;
    }
    let outcome: TargetOutcome;
    try {
      outcome = await runTarget(ctx, t, opened);
      await life.targetEnd(name, outcome.status, outcome.ms);
    } catch (error) {
      // A reject from outside runTarget's own try/catch (an `onlyWhen`/`cacheKey`
      // thunk, a lifecycle hook, or `life.targetEnd`) becomes a failed target so
      // the run finalizes here instead of rejecting out of `execute()` and
      // stranding the record `running`.
      failTarget(reporter, renderer, style, name, 0, error);
      outcome = { status: "failed", ms: 0, error };
    }
    settleTarget(env, name, outcome.status, errorMessage(outcome.error));
    if (outcome.status === "passed" || outcome.status === "failed") opened++;
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    // A fan-out target's sub-targets appear as their own rows beneath it.
    if (outcome.children !== undefined) reports.push(...outcome.children);
    if (outcome.status === "passed") executed.push(name);
    else if (outcome.status === "failed") {
      failure = outcome.error;
      aborted = true;
    }
  }
  return { reports, executed, failure, aborted, suspended: false };
}

/**
 * Run the plan with up to `limit` targets in flight, respecting dependencies.
 * `canOverlap` decides which ready targets may run at the same time: with
 * global parallelism it is always true; otherwise only members of the same
 * {@link group} overlap, keeping ungrouped targets serialized.
 *
 * Each target's framework output is buffered and flushed as a contiguous block
 * on completion, so concurrent runs don't interleave their banners. A failure
 * stops new launches; in-flight targets settle and the rest are skipped.
 */
export async function runScheduled(
  ctx: RunContext,
  order: TargetBuilder[],
  predecessors: Map<TargetBuilder, TargetBuilder[]>,
  skip: Set<string>,
  limit: number,
  canOverlap: (a: TargetBuilder, b: TargetBuilder) => boolean,
): Promise<RunOutcome> {
  const { life, reporter, renderer, style, env } = ctx;
  const outcomes = new Map<TargetBuilder, TargetOutcome>();
  const done = new Set<TargetBuilder>(); // passed/cached/skipped → unblocks dependents
  // Reached a terminal status, whatever it was — `done` plus the failures. This
  // is what an `always` target waits for: it runs *because* something failed, so
  // gating it on `done` (which a failure never enters) is the one thing that
  // guarantees it cannot. A parked wait is deliberately absent: it has not
  // finished, it is going to be resumed, and a finalizer that fired before it
  // resolved would report on a run that is still in progress.
  const settled = new Set<TargetBuilder>();
  const started = new Set<TargetBuilder>();
  const runningSet = new Set<TargetBuilder>();
  let failure: unknown;
  let anyFailed = false; // a failure occurred → the build fails
  let anyWaiting = false; // a `.waitsFor(...)` gate parked → the run suspends
  let halted = false; // a non-lenient failure → stop launching new targets
  let flushed = 0;

  // `--skip` targets, and targets already succeeded on a resumed run, count as
  // completed so their dependents can still run.
  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    if (skip.has(name)) {
      outcomes.set(t, { status: "skipped", ms: 0 });
      done.add(t);
      settled.add(t);
      started.add(t);
      settleTarget(env, name, "skipped");
    } else if (env.done?.has(name)) {
      // Succeeded in the prior (suspended) run: unblock dependents, don't re-run,
      // and leave its recorded `succeeded` untouched.
      outcomes.set(t, { status: "cached", ms: 0 });
      done.add(t);
      settled.add(t);
      started.add(t);
    }
  }

  const ready = (t: TargetBuilder): boolean =>
    (predecessors.get(t) ?? []).every((p) =>
      t.always_ ? settled.has(p) : done.has(p)
    );
  /**
   * Whether `t` can never become ready: a predecessor has settled in a way that
   * does not satisfy it (failed, or skipped), so no later pass will change the
   * answer. A predecessor parked at a `waitsFor` gate is deliberately *not*
   * settled, so a target behind a gate stays pending for a resume instead.
   */
  /** Whether this run can still resume, i.e. whether a parked gate may reopen. */
  const mayStillResume = (): boolean => !anyFailed && !ctx.env.signal.aborted;
  const stranded = (t: TargetBuilder): boolean =>
    !t.always_ &&
    (predecessors.get(t) ?? []).some((p) =>
      (settled.has(p) && !done.has(p)) ||
      // A predecessor parked at a `waitsFor` gate is normally left alone, so a
      // resume can run what is behind it. Once the run has failed or been
      // cancelled it will never suspend and so never resume — the code already
      // converts those parked rows to `skipped` once the pump is done — and
      // until then anything behind the gate counts as unreachable. Without this
      // the teardown behind it stays un-ready and is swept away, and whether
      // that happens depends on whether the gate had launched yet, which is to
      // say on `--parallel`.
      (!mayStillResume() && outcomes.get(p)?.status === "waiting")
    );
  const overlaps = (t: TargetBuilder): boolean =>
    [...runningSet].every((r) => canOverlap(t, r));

  /** Settle a target this run will never launch, so its dependents can proceed. */
  const abandon = (t: TargetBuilder): void => {
    outcomes.set(t, { status: "skipped", ms: 0 });
    started.add(t);
    settled.add(t);
    settleTarget(env, t.name_ ?? "<unnamed>", "skipped");
  };

  await new Promise<void>((resolve) => {
    const pump = () => {
      for (const t of order) {
        if (runningSet.size >= limit) break;
        if (started.has(t)) continue;
        // Settle a target whose prerequisites have made it unreachable, rather
        // than leaving it for the final sweep. An `always` target waits for its
        // predecessors to **settle**, so one that is never launched at all
        // keeps teardown un-ready forever — and teardown is then swept away as
        // skipped alongside the work it existed to clean up.
        if (stranded(t)) {
          abandon(t);
          continue;
        }
        if (!ready(t) || !overlaps(t)) continue;
        // Stop launching once the build has halted on a failure, or the run was
        // cancelled — except `always` targets, which are teardown (stop a
        // container, release a sandbox) and matter most in exactly those two
        // situations.
        //
        // A target this run will therefore never launch is settled `skipped`
        // *here* rather than in the final sweep. That is not cosmetic: an
        // `always` target waits for its predecessors to **settle**, so a
        // predecessor that is never launched keeps teardown un-ready forever,
        // and it is swept away as skipped alongside the work it was meant to
        // clean up — leaking whatever it reclaims. Settling on the spot lets the
        // dependent become ready on this very pass (`order` is topological, so
        // it is still ahead of us in this loop).
        if ((halted || ctx.env.signal.aborted) && !t.always_) {
          abandon(t);
          continue;
        }
        started.add(t);
        runningSet.add(t);
        const buffer = bufferReporter();
        runTarget({ ...ctx, reporter: buffer.reporter }, t, flushed)
          .then(
            async (outcome) => {
              await life.targetEnd(
                t.name_ ?? "<unnamed>",
                outcome.status,
                outcome.ms,
              );
              // A waiting gate already recorded its `waitingFor` via
              // markTargetWaiting; settling it here would clobber that.
              if (outcome.status !== "waiting") {
                settleTarget(
                  env,
                  t.name_ ?? "<unnamed>",
                  outcome.status,
                  errorMessage(outcome.error),
                );
              }
              // An executed target (or a parked wait) prints a block worth
              // separating.
              const printed = outcome.status === "passed" ||
                outcome.status === "failed" || outcome.status === "waiting";
              if (printed) {
                if (!style.github && flushed > 0) reporter.info("");
                buffer.flush(reporter);
                flushed++;
              }
              outcomes.set(t, outcome);
              runningSet.delete(t);
              if (outcome.status !== "waiting") settled.add(t);
              if (outcome.status === "failed") {
                anyFailed = true;
                failure ??= outcome.error;
                // A lenient failure lets independent targets keep going; its
                // own dependents stay blocked (never added to `done`).
                if (!t.proceedAfterFailure_) halted = true;
              } else if (outcome.status === "waiting") {
                // The run suspends here: this target's dependents stay blocked
                // (never `done`), but independent branches run to completion.
                anyWaiting = true;
              } else {
                done.add(t); // passed, cached, or condition-skipped
              }
              pump();
            },
          )
          .catch((error: unknown) => {
            // `runTarget` handles a thrown body itself, but paths outside its
            // try/catch can still reject — an `onlyWhen`/`cacheKey` thunk, a
            // lifecycle hook, or `life.targetEnd` in the fulfilment handler
            // above. Route any such rejection into the normal failure path so
            // the scheduler settles (and finalizes the record) instead of
            // hanging with the target stuck in `runningSet`, or dying on an
            // unhandled rejection.
            //
            // Free the slot and record the failure BEFORE emitting output, so
            // even a throwing reporter (already made best-effort by
            // safeReporter) can never leave `t` in `runningSet` — which would
            // wedge the scheduler's completion `Promise` forever.
            const targetName = t.name_ ?? "<unnamed>";
            outcomes.set(t, { status: "failed", ms: 0, error });
            runningSet.delete(t);
            settled.add(t);
            anyFailed = true;
            failure ??= error;
            if (!t.proceedAfterFailure_) halted = true;
            failTarget(reporter, renderer, style, targetName, 0, error);
            settleTarget(env, targetName, "failed", errorMessage(error));
            pump();
          });
      }
      if (runningSet.size === 0) {
        for (const t of order) {
          if (!started.has(t)) {
            outcomes.set(t, { status: "skipped", ms: 0 });
            started.add(t);
            // When the run *suspends* (a wait parked and nothing failed),
            // targets blocked behind the wait are left `pending` so a resume
            // runs them. A run that also failed will never resume, so settle
            // them `skipped` — otherwise they linger `pending` inside a terminal
            // `failed` record that no resume sweep reaches (F8).
            if (!anyWaiting || anyFailed) {
              settleTarget(env, t.name_ ?? "<unnamed>", "skipped");
            }
          }
        }
        resolve();
      }
    };
    pump();
  });

  // A failed run does not suspend, so any target parked at a `.waitsFor(...)`
  // gate — recorded `waiting` and normally left for a resume — will never be
  // resumed. Settle those rows to a terminal `skipped` so the `failed` record
  // has no permanently-`waiting` target that `runs show` and the resume sweep
  // would otherwise see forever (F8).
  if (anyFailed && anyWaiting) {
    for (const [t, outcome] of outcomes) {
      if (outcome.status === "waiting") {
        outcomes.set(t, { status: "skipped", ms: outcome.ms });
        settleTarget(env, t.name_ ?? "<unnamed>", "skipped");
      }
    }
  }

  const reports: TargetReport[] = [];
  const executed: string[] = [];
  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    const outcome = outcomes.get(t) ?? { status: "skipped", ms: 0 };
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    // A fan-out target's sub-targets appear as their own rows beneath it.
    if (outcome.children !== undefined) reports.push(...outcome.children);
    if (outcome.status === "passed") executed.push(name);
  }
  return {
    reports,
    executed,
    failure,
    aborted: anyFailed,
    suspended: anyWaiting && !anyFailed,
  };
}
