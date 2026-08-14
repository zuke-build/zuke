// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The executor: resolves a plan, runs each target body in order, reports
 * pass/fail with timing, and aborts on the first failure.
 *
 * Visual rendering — colour, the ruled per-target headers, the end-of-build
 * summary table, the GitHub Actions `::group::` commands, and the Markdown
 * job-summary file — lives in `./report.ts`. The executor only decides what to
 * run and feeds the renderer; this module owns orchestration — caching,
 * lifecycle hooks, and the sequential/parallel scheduler — and delegates each
 * other concern to a sibling: the reporting surface and job summary to
 * `./execute_output.ts`, parameter resolution and the skip sets to
 * `./execute_plan.ts`, the durable run record and its writer to
 * `./execute_state.ts`, and the cancellation handshake to `./execute_cancel.ts`.
 *
 * Sequencing and de-duplication are handled by {@link plan} — the returned
 * order already contains each target exactly once, so diamond dependencies run
 * their shared prerequisite a single time.
 */

import type { Build, BuildResult } from "./build.ts";
import { defaultReadEnv, messageOf } from "./internal.ts";
import type { Reporter } from "./reporter.ts";
export type { Reporter } from "./reporter.ts";
import {
  composeOutput,
  emitActionsMasks,
  writeJobSummary,
} from "./execute_output.ts";
import {
  applyAffectedSkips,
  conditionSkips,
  defaultPrompt,
  reportDanglingEdges,
  resolveRunParameters,
} from "./execute_plan.ts";
import { openRunState } from "./execute_state.ts";
import type { HeldLease } from "./state/run_lease.ts";
import { settleCancelledRun } from "./execute_cancel.ts";
import { cancelledElsewhere } from "./cancel.ts";
import { makeLifecycle } from "./lifecycle.ts";
import type { RunOutcome } from "./run_support.ts";
import {
  cpuCount,
  resolveConcurrency,
  type RunContext,
  runScheduled,
  runSequential,
} from "./scheduler.ts";
import { discoverTargets, resolveOrderingEdges } from "./build.ts";
import { type OrderingEdge, planGraph } from "./graph.ts";
import { ParameterError } from "./params.ts";
import {
  type BuildCache,
  CACHE_FILE,
  defaultCacheHost,
  isCacheable,
  openCache,
} from "./cache.ts";
import { ARTIFACT_DIR, findConfigDir, pathExists } from "./config.ts";
import type { AffectedOptions } from "./affected.ts";
import { type RemoteCacheStore, resolveRemoteStore } from "./remote_cache.ts";
import { ServiceRegistry } from "./service.ts";
import { absolutePath } from "./path.ts";
import type { TargetBuilder } from "./target.ts";
import type { RunRecord } from "./state/types.ts";
import { withAmbientSignal } from "./ambient_signal.ts";
import { withAmbientRedactor } from "./ambient_redactor.ts";
import type { StateStore } from "./state/store.ts";
import type { Plugin, RunInfo } from "./plugin.ts";
import type { Renderer } from "./renderer.ts";

/** Options for {@link execute}. */
export interface ExecuteOptions {
  /** Suppress all banner/summary output (used by tests). */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
  /**
   * Lifecycle observers invoked alongside the build's own hooks, in order.
   * Lets third-party packages report/time/notify without subclassing the build.
   */
  plugins?: Plugin[];
  /** Target names to skip even if they appear in the plan (CLI `--skip`). */
  skip?: string[];
  /**
   * Run independent targets concurrently. `false`/omitted runs sequentially in
   * deterministic order; `true` uses the host's CPU count; a number sets the
   * maximum concurrency. Dependencies still complete before their dependents.
   */
  parallel?: boolean | number;
  /**
   * Incremental caching: skip targets whose declared {@link TargetBuilder.inputs}
   * are unchanged since the last successful run (and whose outputs still exist).
   * Defaults to on; pass `false` to disable (CLI `--no-cache`). A {@link
   * BuildCache} may be supplied directly (used in tests).
   */
  cache?: boolean | BuildCache;
  /**
   * A {@link RemoteCacheStore} that shares target {@link TargetBuilder.outputs}
   * across machines: a local cache miss restores outputs from it, and a
   * successful run uploads them. `false` disables it (CLI `--no-remote-cache`).
   * When omitted, the build's `remoteCache()` override is used, falling back to
   * the `ZUKE_REMOTE_CACHE_*` environment variables. Ignored when `cache` is a
   * supplied {@link BuildCache} or is `false`.
   */
  remoteCache?: RemoteCacheStore | false;
  /**
   * Raw parameter values from the command line, keyed by parameter (property)
   * name. Each declared {@link Parameter} is resolved from this map, then the
   * environment, then its declared default before any target runs.
   */
  params?: Record<string, string>;
  /**
   * Reads an environment variable as a parameter fallback. Defaults to
   * `Deno.env.get` (returning `undefined` when env access is unavailable);
   * overridable so parameter resolution can be tested hermetically.
   */
  readEnv?: (name: string) => string | undefined;
  /**
   * Prompt for a missing required parameter, returning the entered value (or
   * `undefined` to leave it unset). Defaults to an interactive terminal prompt
   * when stdin is a TTY and the build is not on CI; overridable for testing.
   */
  prompt?: (
    flag: string,
    description: string | undefined,
  ) => string | undefined;
  /**
   * Plan only: resolve and print every target that *would* run (honouring
   * `--skip` and `onlyWhen` conditions) without executing any body or touching
   * the cache (CLI `--dry-run`).
   */
  dryRun?: boolean;
  /**
   * Restrict the run to the targets affected by files changed since a base git
   * revision (CLI `--affected[=<base>]`). A target is affected when a changed
   * file falls inside its declared {@link TargetBuilder.inputs} or a dependency
   * is affected; a target that declares no inputs is always considered affected.
   * Unaffected targets are skipped. The base revision defaults to `HEAD`; supply
   * `changedFiles` to inject the diff (used in tests).
   */
  affected?: AffectedOptions;
  /**
   * Force GitHub Actions output formatting on or off. Auto-detected from the
   * `GITHUB_ACTIONS` environment variable when omitted.
   */
  github?: boolean;
  /**
   * Force ANSI colour on or off. Auto-detected (a TTY with `NO_COLOR` unset,
   * outside GitHub Actions) when omitted; off by default with a custom reporter.
   */
  color?: boolean;
  /**
   * Renderer for the per-target banners and the end-of-build summary. Defaults
   * to Zuke's built-in {@link "./renderer.ts".defaultRenderer}; `@zuke/console`
   * exports an alternative a build can inject to restyle its output.
   */
  renderer?: Renderer;
  /**
   * Cancel the run when this signal aborts (wired to Ctrl-C/SIGTERM by the CLI,
   * or fired by another process running `zuke cancel`). Every target body's
   * {@link "./target.ts".TargetContext} `signal` mirrors it, and it is applied
   * as the shell's ambient default so an in-flight `$` command is terminated
   * (SIGTERM) on cancellation. When the run is cancelled, the compensations of
   * every target that had **succeeded** run in reverse order (see
   * {@link "./target.ts".TargetBuilder.onCancel}) and the result is a non-ok
   * `cancelled` outcome. A body that ignores its signal still runs to
   * completion, so promptly-cancellable work should pass `ctx.signal` to its
   * shell commands.
   */
  signal?: AbortSignal;
  /**
   * Durable run state (see {@link "./state/store.ts".StateStore}). A supplied
   * store is used directly; `false` disables state entirely. When omitted, the
   * build's `stateStore()` override is used, falling back to `ZUKE_STATE_URL` /
   * `ZUKE_STATE_DIR`, and finally — only when {@link state} is set — a
   * filesystem store under `<root>/.zuke/runs`.
   */
  stateStore?: StateStore | false;
  /**
   * Opt a plain build into durable state (CLI `--state`): fall back to a
   * `.zuke/runs` filesystem store when nothing else is configured. Ignored when
   * a store is resolved from {@link stateStore}, the build, or the environment.
   */
  state?: boolean;
  /**
   * Who to attribute the run to in its state record (CLI `--actor`). Falls back
   * to `ZUKE_ACTOR`, then the CI actor, then `"anonymous"`.
   */
  actor?: string;
  /**
   * Continue a suspended run instead of starting a fresh one. Set by
   * {@link "./resume.ts".resumeRun} after it has transitioned the run to
   * `running`; carries the existing record, its store version, and the targets
   * already succeeded (which are not re-run). Not for direct use — call
   * `resumeRun`.
   */
  resume?: ResumeState;
}

/** The continuation state {@link resumeRun} hands to {@link execute} on a resume. */
export interface ResumeState {
  /** The run being continued (already transitioned to `running`). */
  record: RunRecord;
  /** Its current store version, for the writer to continue from. */
  version: string;
  /** Names of targets recorded `succeeded` — seeded as done, never re-run. */
  done: ReadonlySet<string>;
  /**
   * The lease the resumer took before moving the record out of `suspended`.
   *
   * Held by the resumer rather than acquired here, because the record must never
   * read `running` in the store without its lease already held — that pairing is
   * what tells a sweep the difference between a live run and an abandoned one.
   */
  lease?: HeldLease;
}

/**
 * Execute the requested target and its transitive dependencies.
 *
 * Runs the build's `onStart`/`onFinish` lifecycle hooks around the plan. By
 * default targets run sequentially in deterministic order; with `parallel`,
 * independent targets run concurrently while dependencies still complete first.
 * Stops launching after the first failure, marks unreached targets as skipped,
 * and returns a failing result.
 */
export async function execute(
  build: Build,
  root: TargetBuilder,
  options: ExecuteOptions = {},
): Promise<BuildResult> {
  const {
    baseReporter,
    reporter,
    redactor,
    writesToConsole,
    style,
    renderer,
  } = composeOutput(options);
  const skip = new Set(options.skip ?? []);

  const readEnv = options.readEnv ?? defaultReadEnv;
  const { params, errors: paramErrors } = await resolveRunParameters(
    build,
    options.params ?? {},
    readEnv,
    options.prompt ?? defaultPrompt,
    redactor,
  );
  // Gated on `writesToConsole` so an embedded `execute()` is never handed a raw
  // secret — see emitActionsMasks for why the directive bypasses the redactor.
  if (style.github && writesToConsole) {
    const secrets: string[] = [];
    for (const p of params.values()) {
      const value = p.secret_ ? p.stringValue_() : undefined;
      if (value !== undefined && value !== "") secrets.push(value);
    }
    emitActionsMasks(secrets, baseReporter);
  }
  if (paramErrors.length > 0) {
    reporter.error("Invalid or missing parameters:");
    for (const message of paramErrors) reporter.error(`  ${message}`);
    return {
      ok: false,
      executed: [],
      error: new ParameterError(paramErrors.join("; ")),
    };
  }

  // Soft ordering edges the build declares beyond target-level before/after
  // (`extraEdges` plus the lazy per-run `orderWith` provider, e.g. fed from an
  // external dependency graph); cycle-checked with the rest. The lazy provider
  // may be async and can fail (an unreachable graph service) — since ordering
  // can be a correctness requirement, a failure fails the build cleanly rather
  // than silently running in the base order or crashing with an unhandled
  // rejection. (No run record exists yet, so nothing is stranded.)
  const discovered = discoverTargets(build);
  let extraEdges: OrderingEdge[];
  try {
    extraEdges = await resolveOrderingEdges(build, discovered);
  } catch (error) {
    reporter.error(`Failed to resolve ordering edges: ${messageOf(error)}`);
    return { ok: false, executed: [], error };
  }
  const { order, predecessors } = planGraph(root, extraEdges);
  reportDanglingEdges(extraEdges, order, discovered.values(), reporter);
  // Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets
  // and skip them plus any dependencies that nothing else needs.
  for (const name of await conditionSkips(root, order)) skip.add(name);

  // With `--affected`, skip every planned target a change cannot reach. Skipped
  // targets still unblock their dependents (their prior outputs are assumed
  // current), so an affected target downstream of an unaffected one still runs.
  if (options.affected !== undefined) {
    await applyAffectedSkips(options.affected, order, skip, reporter);
  }

  const limit = resolveConcurrency(options.parallel);
  const globalParallel = limit > 1;
  const grouped = order.some((t) => t.group_ !== undefined);
  // `proceedAfterFailure` and `always` need the scheduler's per-target control,
  // so the simple sequential loop is only used when none of these apply.
  const scheduled = options.resume !== undefined ||
    order.some((t) =>
      t.proceedAfterFailure_ || t.always_ || t.waitsFor_ !== undefined
    );
  const dryRun = options.dryRun ?? false;
  // A dry run never reads or writes the cache (no body runs to invalidate it).
  const cache = dryRun ? undefined : await resolveCache(
    options.cache,
    order,
    build,
    options.remoteCache,
    readEnv,
    reporter,
  );
  const overallStart = performance.now();

  // One run identity per run (stable across a resume), established before the
  // lifecycle so every plugin hook can carry it.
  const runId = options.resume ? options.resume.record.id : crypto.randomUUID();
  const runInfo: RunInfo = { runId, dryRun };

  const life = makeLifecycle(
    build,
    options.plugins ?? [],
    runInfo,
    (message) => reporter.info(message),
  );
  await life.start();

  // Build-level remediations apply to every target (after each target's own),
  // resolved once before the run.
  const globalRecovery = dryRun ? [] : build.recoverWith();

  // One cancellation controller per run. The controller aborts when the caller's
  // `options.signal` does; its signal is handed to every target's context and
  // installed as the shell's ambient signal, so a cancelled run terminates
  // in-flight `$` child processes.
  const runController = new AbortController();
  const onCancel = () => runController.abort();
  if (options.signal !== undefined) {
    if (options.signal.aborted) runController.abort();
    else options.signal.addEventListener("abort", onCancel, { once: true });
  }
  // Set when a state write discovers another process moved this run to
  // `cancelling`/`cancelled` (a `zuke cancel` elsewhere). We then abort and let
  // that canceller own the compensation walk — we do not run it ourselves.
  let externallyCancelled = false;
  const onExternalCancel = () => {
    externallyCancelled = true;
    runController.abort();
  };
  // Set when this run's lease is lost — the store says the claim is somebody
  // else's now, so another process has taken the run over. That is a third,
  // distinct way to stop: nobody asked for a cancellation, and the run is no
  // longer this process's to settle or to unwind.
  let leaseLost = false;
  const onLeaseLost = () => {
    leaseLost = true;
    runController.abort();
  };

  const nowIso = () => new Date().toISOString();
  const opened = await openRunState({
    build,
    root,
    order,
    params: [...params.values()],
    runId,
    dryRun,
    signal: runController.signal,
    redactor,
    reporter,
    readEnv,
    nowIso,
    onExternalCancel,
    stateStore: options.stateStore,
    state: options.state,
    actor: options.actor,
    resume: options.resume,
  });
  if (!opened.ok) {
    reporter.error(opened.error.message);
    return { ok: false, executed: [], error: opened.error };
  }
  const { writer, env } = opened.state;
  const actor = env.actor;
  // The run's lease: this process's claim that it is the one working on this
  // run. Losing it means another process has taken the run over, so this one
  // stops rather than carrying on in parallel with it — whoever holds the claim
  // owns the outcome.
  //
  // Watched either way, released only if this call took it. A resumed run
  // arrives holding its resumer's lease, and that resumer outlives this call, so
  // it is the one that can guarantee the release — including when this call
  // throws before it could reach one.
  const ownLease = opened.state.lease;
  const lease = ownLease ?? options.resume?.lease;
  if (lease !== undefined) {
    // Losing the claim stops the writer *first*. The walk that stops the run
    // settles every target it never reached as `skipped`, and those rows would
    // otherwise land on the record — through the very compare-and-swap that
    // re-reads and re-applies — over the progress the new holder is making.
    const stopOwning = () => {
      writer?.disown();
      onLeaseLost();
    };
    if (lease.lost.aborted) stopOwning();
    else lease.lost.addEventListener("abort", stopOwning, { once: true });
  }

  // Announce the run's initial durable state (`running`) to plugins — a no-op
  // without a store. Terminal transitions are announced once the plan settles.
  if (writer !== undefined) await life.runStateChange(writer.snapshot());

  // Services started during the run are held here and torn down in reverse
  // order once it finishes — in a `finally`, so a failure never leaks a process.
  const services = new ServiceRegistry();
  const ctx: RunContext = {
    life,
    reporter,
    renderer,
    style,
    cache,
    dryRun,
    globalRecovery,
    services,
    env,
  };
  const runPlan = (): Promise<RunOutcome> => {
    if (!globalParallel && !grouped && !scheduled) {
      return runSequential(ctx, order, skip);
    }
    // With `--parallel`, anything independent may overlap up to `limit`.
    // Otherwise only same-group members overlap (the rest stay serialized),
    // bounded by the CPU count.
    const effectiveLimit = globalParallel ? limit : cpuCount();
    const canOverlap = globalParallel
      ? () => true
      : (a: TargetBuilder, b: TargetBuilder) =>
        a.group_ !== undefined && a.group_ === b.group_;
    return runScheduled(
      ctx,
      order,
      predecessors,
      skip,
      effectiveLimit,
      canOverlap,
    );
  };

  let run: RunOutcome;
  try {
    // Run the plan inside the ambient-signal scope so a plain `$` in a target
    // body is cancelled with the run; the binding unwinds on its own, even if
    // the plan throws — nothing to restore. Both schedulers convert every
    // target-path reject into a failed outcome (never rejecting themselves), so
    // the run always settles here rather than stranding the record `running`.
    // The same scope installs the redactor the shell renders command lines
    // through, so a secret passed to `$` as an argv token is masked in the echo
    // and in any error message that quotes the command.
    run = await withAmbientSignal(
      runController.signal,
      () => withAmbientRedactor(redactor, runPlan),
    );
  } finally {
    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", onCancel);
    }
    if (services.size > 0) {
      await services.stopAll((line) => reporter.info(line));
    }
  }
  // A cancellation (Ctrl-C / an aborted `options.signal`, or another process
  // running `zuke cancel`) takes precedence over an ordinary failure: the
  // aborted target failing is a symptom, not the outcome.
  const cancelled = runController.signal.aborted;

  // Whether the fingerprints this run recorded still describe the workspace.
  //
  // A cancellation only invalidates them by *undoing* something, and undoing
  // needs a compensation walk, which needs a writer. Without a state store there
  // is no writer, so nothing can have been rolled back and the fingerprints
  // stand — which matters because a store-less run is the default for exactly
  // the builds that declare no compensation. With a writer, the answer waits for
  // the settlement below to say what the walk actually did.
  let cacheIsTrustworthy = !cancelled || writer === undefined;

  let result: BuildResult;
  if (leaseLost) {
    // The claim is demonstrably somebody else's, so this process no longer owns
    // the run's outcome: it must not settle the record, and above all must not
    // run the compensations. Doing so would unwind work the new holder is
    // building on — the exact "two processes on one run" the lease exists to
    // prevent. Queued per-target writes are drained (they are progress this
    // process really made, and the writer's compare-and-swap merges them under
    // the new holder's version) and then it stops.
    await writer?.drain();
    const lost = new Error(
      `Run ${runId} stopped: its lease was taken over by another process, ` +
        `which now owns the run. Nothing was rolled back — the compensations ` +
        `belong to whoever holds the run.`,
    );
    reporter.error(lost.message);
    result = { ok: false, executed: run.executed, error: lost, runId };
  } else if (cancelled) {
    result = {
      ok: false,
      executed: run.executed,
      cancelled: true,
      runId,
    };
    if (externallyCancelled) {
      // Another process owns the cancellation: it runs the compensations and
      // settles the record. We stop and leave the run `cancelling`, draining any
      // pending per-target writes so none races the process exit.
      await writer?.drain();
      reporter.info(cancelledElsewhere(runId));
    } else if (writer !== undefined) {
      const settlement = await settleCancelledRun({
        writer,
        life,
        order,
        runId,
        actor,
        signals: env.signals,
        reporter,
        redactor,
        nowIso,
        isExternallyCancelled: () => externallyCancelled,
        isLeaseLost: () => leaseLost,
      });
      // A cancellation only invalidates the cache if something was actually
      // undone. A target records its fingerprint when its body returns, and a
      // compensation then reverses that work — usually a *side effect* rather
      // than the declared outputs, which is why the outputs-still-exist check
      // cannot be relied on to notice. But most builds declare no compensation
      // at all, and for those nothing was reversed: throwing their fingerprints
      // away would make every Ctrl-C cost a full rebuild, which is the ordinary
      // develop-interrupt-rerun loop. So the cache is kept when this process ran
      // the walk and the walk did nothing.
      cacheIsTrustworthy = settlement.ownedWalk && settlement.compensated === 0;
      // The claim can change hands *during* the walk, after the branch above
      // chose a cancellation. Report what actually happened: this process
      // neither finished unwinding the run nor settled it.
      if (leaseLost) {
        const lost = new Error(
          `Run ${runId} stopped: its lease was taken over by another process ` +
            `mid-rollback, after ${settlement.compensated} compensation(s). ` +
            `The rest of the rollback, and the run's outcome, belong to ` +
            `whoever holds it now.`,
        );
        reporter.error(lost.message);
        result = { ok: false, executed: run.executed, error: lost, runId };
      }
    }
  } else {
    result = run.aborted
      ? { ok: false, executed: run.executed, error: run.failure, runId }
      : run.suspended
      ? { ok: true, executed: run.executed, suspended: true, runId }
      : { ok: true, executed: run.executed, runId };
    // Record the run's terminal status. Awaiting this drains the writer's queue,
    // so every per-target transition has landed by the time the run returns.
    if (run.suspended) await writer?.markRunSuspended();
    else await writer?.markRunFinished(result.ok);
    // Another process settled this run while it was working — a sweep that found
    // it abandoned or past its deadline, and unwound it. Whatever this process
    // did, the run did not end the way this process thinks: report the failure
    // rather than a success nothing else agrees with.
    if (writer?.settledElsewhere() === true) {
      const settled = new Error(
        `Run ${runId} was settled by another process while this one was ` +
          `working on it (its record says ${writer.snapshot().status}), so ` +
          `this process's result is not the run's outcome.`,
      );
      reporter.error(settled.message);
      result = { ok: false, executed: run.executed, error: settled, runId };
    }
  }

  // Persist the incremental cache, unless this run's fingerprints have been
  // overtaken by events: a rollback that undid the work they describe, or a new
  // holder that now decides what the outputs are.
  if (cache !== undefined && cacheIsTrustworthy && !leaseLost) {
    await cache.save();
  }

  // Released once this run has stopped being ours to work on — which includes
  // the cancelled paths, not just the ones that ran to a finish. A cancelled run
  // leaves a *terminal* record, so holding its claim for the rest of the TTL
  // says a process is still working on a run that demonstrably ended, and blocks
  // the id for a minute for no reason.
  //
  // Two exceptions. A lost lease is not ours to give back: releasing is scoped
  // to the token we no longer hold, so at best it is a no-op and at worst it is
  // an attempt to drop the new holder's claim. And any earlier *throw* leaves
  // this call's lease to lapse at its TTL, which is correct: the record is still
  // `running` and the process really is broken, so a sweep should find it — just
  // a minute later.
  if (!leaseLost) await ownLease?.release();

  // Announce the run's terminal durable state (succeeded/failed/suspended/
  // cancelling) to plugins, now that the transition above has landed.
  if (writer !== undefined) await life.runStateChange(writer.snapshot());

  const totalMs = performance.now() - overallStart;
  for (
    const line of renderer.summaryBlock(style, run.reports, totalMs, result.ok)
  ) {
    reporter.info(line);
  }
  // On suspension, point the operator at the saved run so it can be resumed.
  // A cancelled run never resumes, so it skips this even if it parked a wait.
  if (run.suspended && !cancelled) {
    const waiting = run.reports.filter((r) => r.status === "waiting")
      .map((r) => r.name);
    reporter.info(
      `Run ${runId} suspended — state saved; waiting on: ${
        waiting.join(", ")
      }.`,
    );
  }
  if (style.github && writesToConsole) {
    writeJobSummary(renderer, run.reports, totalMs, result.ok);
  }
  await life.finish(result);
  return result;
}

/**
 * Resolve the incremental cache for a run: `false` disables it, a supplied
 * {@link BuildCache} is used directly, and otherwise a `.zuke/cache.json`-backed
 * cache is opened — but only when at least one target declares inputs. A remote
 * output store is wired in when one is configured (see
 * {@link resolveRemoteStore}).
 */
async function resolveCache(
  option: boolean | BuildCache | undefined,
  order: TargetBuilder[],
  build: Build,
  remoteOption: RemoteCacheStore | false | undefined,
  readEnv: (name: string) => string | undefined,
  reporter: Reporter,
): Promise<BuildCache | undefined> {
  if (option === false) return undefined;
  if (typeof option === "object") return option;
  if (!order.some(isCacheable)) return undefined;
  const root = findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd();
  const storePath = absolutePath(root)(ARTIFACT_DIR, CACHE_FILE).path;
  const remote = resolveRemoteStore(remoteOption, build.remoteCache(), readEnv);
  return await openCache(storePath, defaultCacheHost, {
    remote,
    warn: (message) => reporter.info(message),
  });
}
