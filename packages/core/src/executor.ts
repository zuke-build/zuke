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

import type { Build, BuildResult, TargetStatus } from "./build.ts";
import { planGraph } from "./graph.ts";
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
import { ServiceBuilder, ServiceRegistry } from "./service.ts";
import { Redactor } from "./redact.ts";
import { absolutePath } from "./path.ts";
import type { Remediation, TargetBuilder, TargetFn } from "./target.ts";
import type { Plugin } from "./plugin.ts";
import { detectWidth, type Style, type TargetReport } from "./report.ts";
import { defaultRenderer, type Renderer } from "./renderer.ts";

/** The artifact directory (under the repo root) for the cache store. */
const ARTIFACT_DIR = ".zuke";

/** Sink for executor output, defaulting to the console. Overridable in tests. */
export interface Reporter {
  /** Write an informational line. */
  info(line: string): void;
  /** Write an error line. */
  error(line: string): void;
}

const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** Wrap a reporter so every line is passed through the {@link Redactor} first. */
function redactingReporter(inner: Reporter, redactor: Redactor): Reporter {
  return {
    info: (line) => inner.info(redactor.redact(line)),
    error: (line) => inner.error(redactor.redact(line)),
  };
}

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
}

/** Whether the build is running inside a GitHub Actions runner. */
function inGitHubActions(): boolean {
  try {
    return Deno.env.get("GITHUB_ACTIONS") === "true";
  } catch {
    return false;
  }
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
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

/** The result of one target, plus the framework error if it failed. */
interface TargetOutcome {
  status: TargetStatus;
  ms: number;
  error?: unknown;
}

/** What a run (sequential or parallel) produced, fed into the shared summary. */
interface RunOutcome {
  reports: TargetReport[];
  executed: string[];
  failure: unknown;
  aborted: boolean;
}

/**
 * The merged lifecycle: the build's own hooks plus any registered plugins,
 * invoked in order (build first, then each plugin). The run functions call
 * through this so they need not know about plugins.
 */
interface Lifecycle {
  start(): Promise<void>;
  targetStart(name: string): Promise<void>;
  targetEnd(name: string, status: TargetStatus): Promise<void>;
  finish(result: BuildResult): Promise<void>;
}

/** Compose a build and its plugins into one {@link Lifecycle}. */
function makeLifecycle(build: Build, plugins: Plugin[]): Lifecycle {
  return {
    async start() {
      await build.onStart();
      for (const p of plugins) await p.onStart?.();
    },
    async targetStart(name) {
      await build.onTargetStart(name);
      for (const p of plugins) await p.onTargetStart?.(name);
    },
    async targetEnd(name, status) {
      await build.onTargetEnd(name, status);
      for (const p of plugins) await p.onTargetEnd?.(name, status);
    },
    async finish(result) {
      await build.onFinish(result);
      for (const p of plugins) await p.onFinish?.(result);
    },
  };
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a target body once, rejecting with a timeout error if it runs longer than
 * `timeoutMs`. A timed-out body cannot be cancelled (JavaScript has no such
 * primitive), so it keeps running in the background — but its result is ignored.
 */
function runWithTimeout(
  fn: TargetFn,
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

/**
 * Run a target body, applying its {@link TargetBuilder.timeout} and
 * {@link TargetBuilder.retry} settings: each attempt is bounded by the timeout,
 * and a failure is retried (after an optional delay) up to the retry count
 * before the last error propagates.
 */
async function runBody(t: TargetBuilder): Promise<void> {
  const fn = t.fn_;
  if (fn === undefined) return; // guarded by the caller
  const attempts = t.retries_ + 1;
  for (let attempt = 1;; attempt++) {
    try {
      await runWithTimeout(fn, t.timeout_);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
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
): Promise<void> {
  try {
    await runBody(t);
    return;
  } catch (error) {
    // A target's own remediations run first, then any build-level ones.
    const remediations = [...t.recoverWith_, ...globalRecovery];
    if (remediations.length === 0) throw error;
    let lastError = error;
    for (let attempt = 1; attempt <= t.recoverAttempts_; attempt++) {
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
        await runBody(t);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
}

/**
 * Run one target: honour its `onlyWhen` conditions and the incremental cache,
 * then (if it must run) open its section, run its body, and report pass/fail.
 * A condition that fails yields `skipped`; an up-to-date target yields `cached`
 * — both unblock dependents without executing the body. With `dryRun`, a target
 * that would run is reported without executing its body or touching the cache.
 */
async function runTarget(
  life: Lifecycle,
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  t: TargetBuilder,
  opened: number,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
): Promise<TargetOutcome> {
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

  if (cache !== undefined && await cache.upToDate(t)) {
    return { status: "cached", ms: 0 };
  }

  openTarget(reporter, renderer, style, name, opened);
  await life.targetStart(name);
  const start = performance.now();

  if (!t.fn_) {
    const error = new Error(
      `Target "${name}" has no body — call .executes(...) before running.`,
    );
    failTarget(reporter, renderer, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  try {
    for (const v of t.validateBefore_) await v.validate({ target: name });
    await runBodyWithRecovery(t, name, globalRecovery);
    for (const v of t.validateAfter_) await v.validate({ target: name });
    const ms = performance.now() - start;
    if (cache !== undefined) await cache.record(t);
    passTarget(reporter, renderer, style, name, ms);
    return { status: "passed", ms };
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  }
}

/** Resolve the concurrency limit; 1 means sequential. */
function resolveConcurrency(option: boolean | number | undefined): number {
  if (option === undefined || option === false) return 1;
  if (option === true) return cpuCount();
  return option > 1 ? Math.floor(option) : 1;
}

/** The host's CPU count, used as the default parallel/batch concurrency. */
function cpuCount(): number {
  const cpus = navigator.hardwareConcurrency;
  return cpus > 0 ? cpus : 4;
}

/** A reporter that buffers lines so a target's block can flush atomically. */
function bufferReporter(): {
  reporter: Reporter;
  flush: (to: Reporter) => void;
} {
  const lines: Array<{ error: boolean; text: string }> = [];
  return {
    reporter: {
      info: (text) => void lines.push({ error: false, text }),
      error: (text) => void lines.push({ error: true, text }),
    },
    flush: (to) => {
      for (const line of lines) {
        if (line.error) to.error(line.text);
        else to.info(line.text);
      }
    },
  };
}

/** Sequentially run the plan, aborting (and skipping the rest) on first failure. */
async function runSequential(
  life: Lifecycle,
  order: TargetBuilder[],
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  skip: Set<string>,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
): Promise<RunOutcome> {
  const reports: TargetReport[] = [];
  const executed: string[] = [];
  let failure: unknown;
  let aborted = false;
  let opened = 0;

  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    if (skip.has(name) || aborted) {
      reports.push({ name, status: "skipped", ms: 0 });
      continue;
    }
    const outcome = await runTarget(
      life,
      reporter,
      renderer,
      style,
      t,
      opened,
      cache,
      dryRun,
      globalRecovery,
      services,
    );
    await life.targetEnd(name, outcome.status);
    if (outcome.status === "passed" || outcome.status === "failed") opened++;
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    if (outcome.status === "passed") executed.push(name);
    else if (outcome.status === "failed") {
      failure = outcome.error;
      aborted = true;
    }
  }
  return { reports, executed, failure, aborted };
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
async function runScheduled(
  life: Lifecycle,
  order: TargetBuilder[],
  predecessors: Map<TargetBuilder, TargetBuilder[]>,
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  skip: Set<string>,
  limit: number,
  canOverlap: (a: TargetBuilder, b: TargetBuilder) => boolean,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
): Promise<RunOutcome> {
  const outcomes = new Map<TargetBuilder, TargetOutcome>();
  const done = new Set<TargetBuilder>(); // passed/cached/skipped → unblocks dependents
  const started = new Set<TargetBuilder>();
  const runningSet = new Set<TargetBuilder>();
  let failure: unknown;
  let anyFailed = false; // a failure occurred → the build fails
  let halted = false; // a non-lenient failure → stop launching new targets
  let flushed = 0;

  // `--skip` targets count as completed so their dependents can still run.
  for (const t of order) {
    if (skip.has(t.name_ ?? "<unnamed>")) {
      outcomes.set(t, { status: "skipped", ms: 0 });
      done.add(t);
      started.add(t);
    }
  }

  const ready = (t: TargetBuilder): boolean =>
    (predecessors.get(t) ?? []).every((p) => done.has(p));
  const overlaps = (t: TargetBuilder): boolean =>
    [...runningSet].every((r) => canOverlap(t, r));

  await new Promise<void>((resolve) => {
    const pump = () => {
      for (const t of order) {
        if (runningSet.size >= limit) break;
        if (started.has(t) || !ready(t) || !overlaps(t)) continue;
        // After a fatal failure, stop launching — except `always` targets,
        // which run for cleanup even when the build is failing.
        if (halted && !t.always_) continue;
        started.add(t);
        runningSet.add(t);
        const buffer = bufferReporter();
        runTarget(
          life,
          buffer.reporter,
          renderer,
          style,
          t,
          flushed,
          cache,
          dryRun,
          globalRecovery,
          services,
        )
          .then(
            async (outcome) => {
              await life.targetEnd(t.name_ ?? "<unnamed>", outcome.status);
              // Only an executed target prints a block worth separating.
              const printed = outcome.status === "passed" ||
                outcome.status === "failed";
              if (printed) {
                if (!style.github && flushed > 0) reporter.info("");
                buffer.flush(reporter);
                flushed++;
              }
              outcomes.set(t, outcome);
              runningSet.delete(t);
              if (outcome.status === "failed") {
                anyFailed = true;
                failure ??= outcome.error;
                // A lenient failure lets independent targets keep going; its
                // own dependents stay blocked (never added to `done`).
                if (!t.proceedAfterFailure_) halted = true;
              } else {
                done.add(t); // passed, cached, or condition-skipped
              }
              pump();
            },
          );
      }
      if (runningSet.size === 0) {
        for (const t of order) {
          if (!started.has(t)) {
            outcomes.set(t, { status: "skipped", ms: 0 });
            started.add(t);
          }
        }
        resolve();
      }
    };
    pump();
  });

  const reports: TargetReport[] = [];
  const executed: string[] = [];
  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    const outcome = outcomes.get(t) ?? { status: "skipped", ms: 0 };
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    if (outcome.status === "passed") executed.push(name);
  }
  return { reports, executed, failure, aborted: anyFailed };
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
  const reporter = redactingReporter(baseReporter, redactor);
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
  // is not wrapped in the redactor — a masked directive would hide nothing.
  if (style.github) {
    for (const p of params.values()) {
      const value = p.secret_ ? p.stringValue_() : undefined;
      if (value !== undefined && value !== "") {
        baseReporter.info(`::add-mask::${value}`);
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

  const { order, predecessors } = planGraph(root);
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
  const scheduled = order.some((t) => t.proceedAfterFailure_ || t.always_);
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

  const life = makeLifecycle(build, options.plugins ?? []);
  await life.start();

  // Build-level remediations apply to every target (after each target's own),
  // resolved once before the run.
  const globalRecovery = dryRun ? [] : build.recoverWith();

  // Services started during the run are held here and torn down in reverse
  // order once it finishes — in a `finally`, so a failure never leaks a process.
  const services = new ServiceRegistry();
  const runPlan = (): Promise<RunOutcome> => {
    if (!globalParallel && !grouped && !scheduled) {
      return runSequential(
        life,
        order,
        reporter,
        renderer,
        style,
        skip,
        cache,
        dryRun,
        globalRecovery,
        services,
      );
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
      life,
      order,
      predecessors,
      reporter,
      renderer,
      style,
      skip,
      effectiveLimit,
      canOverlap,
      cache,
      dryRun,
      globalRecovery,
      services,
    );
  };

  let run: RunOutcome;
  try {
    run = await runPlan();
  } finally {
    if (services.size > 0) {
      await services.stopAll((line) => reporter.info(line));
    }
  }
  if (cache !== undefined) await cache.save();

  const result: BuildResult = run.aborted
    ? { ok: false, executed: run.executed, error: run.failure }
    : { ok: true, executed: run.executed };

  const totalMs = performance.now() - overallStart;
  for (
    const line of renderer.summaryBlock(style, run.reports, totalMs, result.ok)
  ) {
    reporter.info(line);
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
