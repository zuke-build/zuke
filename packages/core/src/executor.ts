/**
 * The executor: resolves a plan, runs each target body in order, reports
 * pass/fail with timing, and aborts on the first failure.
 *
 * Visual rendering — colour, the ruled per-target headers, the end-of-build
 * summary table, the GitHub Actions `::group::` commands, and the Markdown
 * job-summary file — lives in `./report.ts`. The executor only decides what to
 * run and feeds the renderer; this module owns orchestration, parameter
 * resolution, caching, lifecycle hooks, and the sequential/parallel scheduler.
 *
 * Sequencing and de-duplication are handled by {@link plan} — the returned
 * order already contains each target exactly once, so diamond dependencies run
 * their shared prerequisite a single time.
 */

import type { Build, BuildResult } from "./build.ts";
import { defaultReadEnv } from "./internal.ts";
import {
  consoleReporter,
  redactingReporter,
  type Reporter,
  safeReporter,
  silentReporter,
} from "./reporter.ts";
export type { Reporter } from "./reporter.ts";
import { makeLifecycle } from "./lifecycle.ts";
import type { RunEnv, RunOutcome } from "./run_support.ts";
import {
  cpuCount,
  resolveConcurrency,
  type RunContext,
  runScheduled,
  runSequential,
} from "./scheduler.ts";
import { discoverTargets, resolveOrderingEdges } from "./build.ts";
import { type OrderingEdge, planGraph } from "./graph.ts";
import {
  discoverParameters,
  ParameterError,
  resolveParameters,
} from "./params.ts";
import {
  type BuildCache,
  CACHE_FILE,
  defaultCacheHost,
  isCacheable,
  openCache,
} from "./cache.ts";
import { findConfigDir, pathExists } from "./config.ts";
import {
  type AffectedOptions,
  affectedTargets,
  gitChangedFiles,
} from "./affected.ts";
import { type RemoteCacheStore, resolveRemoteStore } from "./remote_cache.ts";
import { isCI } from "./host.ts";
import { ServiceRegistry } from "./service.ts";
import { Redactor } from "./redact.ts";
import { absolutePath } from "./path.ts";
import type { TargetBuilder } from "./target.ts";
import type { RunRecord, SignalRecord, WaitState } from "./state/types.ts";
import { withAmbientSignal } from "./ambient_signal.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import { buildRunRecord, ciRunUrl, resolveActor } from "./state/record.ts";
import { RunStateWriter } from "./state/writer.ts";
import { cancelEvent, compensationEvents, runCompensations } from "./cancel.ts";
import type { Plugin, RunInfo } from "./plugin.ts";
import { detectWidth, type Style, type TargetReport } from "./report.ts";
import { defaultRenderer, type Renderer } from "./renderer.ts";

/** The artifact directory (under the repo root) for the cache store. */
const ARTIFACT_DIR = ".zuke";

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
   * to Zuke's built-in {@link defaultRenderer}; `@zuke/console` exports an
   * alternative a build can inject to restyle its output.
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
}

/**
 * The still-waiting targets of a resumed run, mapped to the {@link WaitState}
 * they last recorded — the source of the original timeout deadline that a
 * re-suspend must preserve (see {@link RunEnv.priorWaits}).
 */
function priorWaitsOf(record: RunRecord): ReadonlyMap<string, WaitState> {
  const waits = new Map<string, WaitState>();
  for (const [name, state] of Object.entries(record.targets)) {
    if (state.waitingFor !== undefined) waits.set(name, state.waitingFor);
  }
  return waits;
}

/** Whether the build is running inside a GitHub Actions runner. */
function inGitHubActions(): boolean {
  try {
    return Deno.env.get("GITHUB_ACTIONS") === "true";
  } catch {
    return false;
  }
}

/** Prompt for a missing required parameter, only at an interactive (non-CI) TTY. */
function defaultPrompt(
  flag: string,
  description: string | undefined,
): string | undefined {
  let interactive = false;
  try {
    interactive = Deno.stdin.isTerminal();
  } catch {
    interactive = false;
  }
  if (!interactive || isCI()) return undefined;
  const label = description ? `--${flag} (${description})` : `--${flag}`;
  return prompt(`${label}:`) ?? undefined;
}

/**
 * Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets;
 * return the names to skip — those targets plus any dependencies that no other
 * target in the plan needs.
 */
async function conditionSkips(
  root: TargetBuilder,
  order: TargetBuilder[],
): Promise<Set<string>> {
  const pruned = new Set<TargetBuilder>();
  for (const t of order) {
    if (!t.skipDependencies_ || t.onlyWhen_.length === 0) continue;
    let run = true;
    for (const condition of t.onlyWhen_) {
      if (!(await condition())) {
        run = false;
        break;
      }
    }
    if (!run) pruned.add(t);
  }
  if (pruned.size === 0) return new Set();

  // Everything still reachable from the root without pulling dependencies in
  // *through* a pruned target.
  const kept = new Set<TargetBuilder>();
  const walk = (node: TargetBuilder) => {
    if (node === undefined || kept.has(node)) return;
    kept.add(node);
    if (pruned.has(node)) return;
    for (const dep of node.dependsOn_) walk(dep);
    for (const trigger of node.triggers_) walk(trigger);
  };
  walk(root);

  const names = new Set<string>();
  for (const t of pruned) names.add(t.name_ ?? "");
  for (const t of order) if (!kept.has(t)) names.add(t.name_ ?? "");
  return names;
}

/** Whether terminal colour should be used (TTY, and `NO_COLOR` unset). */
function autoColor(): boolean {
  try {
    if (Deno.env.get("NO_COLOR")) return false;
  } catch {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** Resolve the output style from the options and the detected environment. */
function resolveStyle(options: ExecuteOptions, github: boolean): Style {
  const color = options.color ??
    (github || options.reporter !== undefined ? false : autoColor());
  return { github, color, width: detectWidth() };
}

/** Append the Markdown job-summary table to `GITHUB_STEP_SUMMARY`, if set. */
function writeJobSummary(
  renderer: Renderer,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
): void {
  let path: string | undefined;
  try {
    path = Deno.env.get("GITHUB_STEP_SUMMARY");
  } catch {
    return;
  }
  if (path === undefined || path === "") return;
  try {
    // Append, not overwrite: validations like the AI reviewers/fixer write their
    // own sections to this same file during the run, and overwriting here would
    // wipe them. GitHub provisions a fresh summary file per step, so a single
    // run's appends never accumulate across steps.
    Deno.writeTextFileSync(
      path,
      renderer.jobSummaryMarkdown(reports, totalMs, ok),
      { append: true },
    );
  } catch {
    // Best-effort: an unwritable summary file must never fail the build.
  }
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
  const baseReporter = options.reporter ??
    (options.silent ? silentReporter : consoleReporter);
  // Every line Zuke prints passes through the redactor, which masks the
  // resolved value of each `secret` parameter. The redactor is populated during
  // parameter resolution below; since nothing meaningful is reported before
  // then, wrapping the reporter up-front is safe.
  const redactor = new Redactor();
  // …and every write is best-effort (see safeReporter): a throwing sink (a buggy
  // custom reporter, or EPIPE on a piped stdout) must never escape `failTarget`
  // and reject out of a scheduler, which would strand the run record `running`.
  const reporter = safeReporter(redactingReporter(baseReporter, redactor));
  // The GitHub job summary is a real-world output side effect (it appends to a
  // shared file named by GITHUB_STEP_SUMMARY). Only write it when output goes to
  // the default console — i.e. neither silenced nor redirected to a custom
  // reporter. This keeps embedded/test runs (a build's own test suite calls
  // `execute` with `silent`/a custom reporter) from polluting the workflow
  // summary, while a normal CLI run still writes it.
  const writesToConsole = options.reporter === undefined && !options.silent;
  const github = options.github ?? inGitHubActions();
  const style = resolveStyle(options, github);
  const renderer = options.renderer ?? defaultRenderer;
  const skip = new Set(options.skip ?? []);

  // Resolve declared parameters (CLI value → environment → default) before any
  // target runs, so a target body can read `this.param.value`. A missing
  // required parameter or an invalid value fails the build before it starts.
  const params = discoverParameters(build);
  const readEnv = options.readEnv ?? defaultReadEnv;
  const paramErrors = await resolveParameters(
    params,
    options.params ?? {},
    readEnv,
    options.prompt ?? defaultPrompt,
    redactor,
  );
  // Register each secret's final parsed value too — its raw form was already
  // added during resolution, but a source that trims or a parser that
  // normalises could yield a slightly different printed string.
  for (const p of params.values()) {
    if (!p.secret_) continue;
    const value = p.stringValue_();
    if (value !== undefined && value !== "") redactor.add(value);
  }
  // Under GitHub Actions, also emit `::add-mask::` with the real value so the
  // runner masks it in its own logs. This goes through the base reporter, which
  // is not wrapped in the redactor — a masked directive would hide nothing. Gate
  // it on `writesToConsole` too: when a custom reporter is supplied it *is* the
  // base reporter, so an embedded `execute()` must never be handed the raw
  // secret — only the real runner stdout should receive the directive.
  if (style.github && writesToConsole) {
    const maskReporter = safeReporter(baseReporter);
    for (const p of params.values()) {
      const value = p.secret_ ? p.stringValue_() : undefined;
      if (value !== undefined && value !== "") {
        // Straight to the base reporter (not redacted, so the directive works),
        // but best-effort: an EPIPE here must not abort the run either.
        maskReporter.info(`::add-mask::${value}`);
      }
    }
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
  let extraEdges: OrderingEdge[];
  try {
    extraEdges = await resolveOrderingEdges(build, discoverTargets(build));
  } catch (error) {
    reporter.error(
      `Failed to resolve ordering edges: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: false, executed: [], error };
  }
  const { order, predecessors } = planGraph(root, extraEdges);
  // Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets
  // and skip them plus any dependencies that nothing else needs.
  for (const name of await conditionSkips(root, order)) skip.add(name);

  // With `--affected`, skip every planned target a change cannot reach. Skipped
  // targets still unblock their dependents (their prior outputs are assumed
  // current), so an affected target downstream of an unaffected one still runs.
  if (options.affected !== undefined) {
    const base = options.affected.base ?? "HEAD";
    const changedFiles = options.affected.changedFiles ?? gitChangedFiles;
    const affected = affectedTargets(order, await changedFiles(base));
    for (const t of order) {
      if (!affected.has(t)) skip.add(t.name_ ?? "<unnamed>");
    }
    if (affected.size === 0) {
      reporter.info(`No targets affected by changes since ${base}.`);
    }
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

  // Resolve the durable state store (if any) and open a writer that records the
  // run and its per-target transitions. Never for a dry run — no body executes,
  // so there is no run to persist. State writes are best-effort: a store hiccup
  // is reported, never fatal (see RunStateWriter).
  // A build that uses a durable feature (a cross-run lock; later, waits and
  // compensations) turns the filesystem store on by default, so state "just
  // works" without --state. Plain builds still opt in explicitly.
  const usesDurableFeature = order.some((t) =>
    t.lock_ !== undefined || t.waitsFor_ !== undefined ||
    t.onCancel_ !== undefined
  );
  const stateStore = dryRun ? undefined : resolveStateStore(
    options.stateStore,
    build.stateStore(),
    {
      readEnv,
      host: defaultStateHost,
      defaultDir: absolutePath(
        findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
      )(ARTIFACT_DIR, "runs").path,
      enableDefault: (options.state ?? false) || usesDurableFeature,
    },
  );
  // A wait needs somewhere to persist the suspension; without a store it could
  // never be resumed. Fail fast with guidance instead of suspending into the
  // void. (enableDefault turns the FS store on for waits, so this only triggers
  // when state was explicitly disabled.)
  if (
    !dryRun && stateStore === undefined &&
    order.some((t) => t.waitsFor_ !== undefined)
  ) {
    const error = new Error(
      "A target uses .waitsFor(...), which needs a state store to persist the " +
        "suspended run — but state is disabled. Enable it (drop stateStore: " +
        "false, pass --state, or set ZUKE_STATE_DIR / ZUKE_STATE_URL).",
    );
    reporter.error(error.message);
    return { ok: false, executed: [], error };
  }
  const actor = resolveActor(options.actor, readEnv);
  const runUrl = ciRunUrl(readEnv);
  const nowIso = () => new Date().toISOString();
  const warn = (message: string) => reporter.info(message);
  const writer = stateStore === undefined
    ? undefined
    : options.resume !== undefined
    // A resume continues the existing record (already transitioned to running).
    ? RunStateWriter.adopt(
      stateStore,
      options.resume.record,
      options.resume.version,
      nowIso,
      redactor,
      warn,
      onExternalCancel,
    )
    : await RunStateWriter.open(
      stateStore,
      buildRunRecord({
        runId,
        build: build.constructor.name,
        rootTarget: root.name_ ?? "<unnamed>",
        actor,
        now: nowIso(),
        order,
        params: params.values(),
      }),
      nowIso,
      redactor,
      warn,
      onExternalCancel,
    );
  const env: RunEnv = {
    runId,
    signal: runController.signal,
    writer,
    store: stateStore,
    actor,
    runUrl,
    signals: writer ? writer.signals() : new Map<string, SignalRecord>(),
    done: options.resume?.done,
    priorWaits: options.resume
      ? priorWaitsOf(options.resume.record)
      : undefined,
  };

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
    run = await withAmbientSignal(runController.signal, runPlan);
  } finally {
    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", onCancel);
    }
    if (services.size > 0) {
      await services.stopAll((line) => reporter.info(line));
    }
  }
  if (cache !== undefined) await cache.save();

  // A cancellation (Ctrl-C / an aborted `options.signal`, or another process
  // running `zuke cancel`) takes precedence over an ordinary failure: the
  // aborted target failing is a symptom, not the outcome.
  const cancelled = runController.signal.aborted;
  let result: BuildResult;
  if (cancelled) {
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
      reporter.info(
        `Run ${runId} cancelled by another process — stopping.`,
      );
    } else if (writer !== undefined) {
      // Hold the per-run cancel lock while we compensate, so a concurrent
      // `zuke cancel` can't settle the run (declaring "no compensations") over
      // our live cleanup. We only reach here with `externallyCancelled` false
      // (the true case stopped above), so always attempt the acquire; a `null`
      // result means another process already holds the lock and owns the walk —
      // we stop and drain (F7).
      const cancelLock = await writer.acquireCancelLock(actor);
      if (cancelLock === null) {
        await writer.drain();
        reporter.info(
          `Run ${runId} cancelled by another process — stopping.`,
        );
      } else {
        try {
          // We initiated it (Ctrl-C / options.signal): mark cancelling (which
          // also drains every pending per-target write, so the snapshot is
          // current).
          await writer.markRunCancelling();
          // markRunCancelling drains the write chain, so if another process's
          // `zuke cancel` won the race in the meantime, the conflict has already
          // fired onExternalCancel. Re-check before walking, so we never run the
          // compensations twice (that canceller owns them now).
          if (externallyCancelled) {
            await writer.drain();
            reporter.info(
              `Run ${runId} cancelled by another process — stopping.`,
            );
          } else {
            // Announce the intermediate `cancelling` transition (the record was
            // just moved there) before compensations run, so a plugin sees the
            // full running → cancelling → cancelled sequence.
            await life.runStateChange(writer.snapshot());
            // Run the succeeded targets' compensations in reverse order, record
            // the cancellation in the audit trail (as `zuke cancel` does), then
            // settle.
            const comp = await runCompensations(order, writer.snapshot(), {
              runId,
              signals: env.signals,
              reporter,
              redactor,
            });
            const at = nowIso();
            for (const event of compensationEvents(comp.attempts, actor, at)) {
              await writer.appendEvent(event);
            }
            await writer.appendEvent(cancelEvent(actor, comp, at));
            await writer.markRunCancelled();
            reporter.info(
              `Run ${runId} cancelled — ${comp.compensated.length} ` +
                `compensation(s) ran${
                  comp.failures.length > 0
                    ? `, ${comp.failures.length} failed`
                    : ""
                }.`,
            );
          }
        } finally {
          await cancelLock?.release();
        }
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
  }

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
