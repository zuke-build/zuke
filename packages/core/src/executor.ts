/**
 * The executor: resolves a plan, runs each target body in order, reports
 * pass/fail with timing, and aborts on the first failure.
 *
 * Output adapts to where the build runs. Under GitHub Actions each target is
 * wrapped in a collapsible log group (`::group::`/`::endgroup::`) with an
 * `::error::` annotation on failure and a Markdown table appended to the job
 * summary. In a terminal, targets are separated by blank lines and coloured
 * (bold headers, green/red/dim status) when stdout is a TTY and `NO_COLOR` is
 * unset; piped output stays plain. Either way a per-target summary — each
 * target's status and duration, plus the total — is printed when the build
 * finishes.
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
import { isCI } from "./host.ts";
import { absolutePath } from "./path.ts";
import type { TargetBuilder } from "./target.ts";

/** The artifact directory (under the repo root) for the cache store. */
const ARTIFACT_DIR = ".zuke";

/** Sink for executor output, defaulting to the console. Overridable in tests. */
export interface Reporter {
  info(line: string): void;
  error(line: string): void;
}

const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** Options for {@link execute}. */
export interface ExecuteOptions {
  /** Suppress all banner/summary output (used by tests). */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
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
   * Force GitHub Actions output formatting on or off. Auto-detected from the
   * `GITHUB_ACTIONS` environment variable when omitted.
   */
  github?: boolean;
  /**
   * Force ANSI colour on or off. Auto-detected (a TTY with `NO_COLOR` unset,
   * outside GitHub Actions) when omitted; off by default with a custom reporter.
   */
  color?: boolean;
}

interface TargetReport {
  name: string;
  status: TargetStatus;
  ms: number;
}

const ICON: Record<TargetStatus, string> = {
  passed: "✔",
  failed: "✘",
  skipped: "⊘",
  cached: "⊙",
};

/** ANSI select-graphic-rendition codes used for terminal colour. */
const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

/** How a run renders its output. */
interface Style {
  github: boolean;
  color: boolean;
}

/** Wrap text in ANSI codes when colour is enabled, otherwise return it as-is. */
function paint(color: boolean, codes: string, text: string): string {
  return color ? `${codes}${text}${SGR.reset}` : text;
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
  if (options.color !== undefined) return { github, color: options.color };
  if (github || options.reporter !== undefined) return { github, color: false };
  return { github, color: autoColor() };
}

/** Format a duration in milliseconds as `1.2s`. */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Open a target's section — a collapsible group under GitHub Actions, or a
 * blank-line-separated bold header in a terminal.
 */
function openTarget(
  r: Reporter,
  style: Style,
  name: string,
  opened: number,
): void {
  if (style.github) {
    r.info(`::group::${name}`);
    return;
  }
  if (opened > 0) r.info("");
  r.info(paint(style.color, SGR.bold + SGR.cyan, `▶ ${name}`));
}

/** Close a target's section after it succeeded. */
function passTarget(
  r: Reporter,
  style: Style,
  name: string,
  ms: number,
): void {
  const icon = paint(style.color, SGR.green, ICON.passed);
  const time = paint(style.color, SGR.dim, `(${formatDuration(ms)})`);
  r.info(`${icon} ${name} ${time}`);
  if (style.github) r.info("::endgroup::");
}

/** Close a target's section after it failed and surface the error. */
function failTarget(
  r: Reporter,
  style: Style,
  name: string,
  ms: number,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  r.error(
    paint(
      style.color,
      SGR.red,
      `${ICON.failed} ${name} (${formatDuration(ms)})`,
    ),
  );
  r.error(paint(style.color, SGR.red, message));
  if (style.github) {
    r.info("::endgroup::");
    r.error(`::error title=${name}::${name} failed: ${message}`);
  }
}

const ROW_COLOR: Record<TargetStatus, string> = {
  passed: SGR.green,
  failed: SGR.red,
  skipped: SGR.dim,
  cached: SGR.cyan,
};

/** Render the end-of-build summary block. */
function summaryBlock(
  style: Style,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
): string {
  const width = reports.reduce((w, x) => Math.max(w, x.name.length), 0);
  const rows = reports.map((x) => {
    const icon = paint(style.color, ROW_COLOR[x.status], ICON[x.status]);
    const ran = x.status === "passed" || x.status === "failed";
    const right = ran ? formatDuration(x.ms) : x.status;
    return `  ${icon} ${x.name.padEnd(width)}  ${right}`;
  });
  const succeeded =
    reports.filter((x) => x.status === "passed" || x.status === "cached")
      .length;
  const banner = paint(
    style.color,
    SGR.bold + (ok ? SGR.green : SGR.red),
    `${ok ? ICON.passed : ICON.failed} ${ok ? "SUCCESS" : "FAILED"} — ` +
      `${succeeded}/${reports.length} targets in ${formatDuration(totalMs)}`,
  );
  return [
    "",
    paint(style.color, SGR.bold, "Build summary:"),
    ...rows,
    "",
    banner,
  ]
    .join("\n");
}

/** Append a Markdown summary to the GitHub Actions job-summary file, if set. */
function writeJobSummary(
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

  const succeeded =
    reports.filter((x) => x.status === "passed" || x.status === "cached")
      .length;
  const rows = reports.map((x) => {
    const ran = x.status === "passed" || x.status === "failed";
    const time = ran ? formatDuration(x.ms) : "—";
    return `| ${x.name} | ${ICON[x.status]} ${x.status} | ${time} |`;
  });
  const markdown = [
    `## ${ok ? "✅" : "❌"} Zuke build — ${succeeded}/${reports.length} ` +
    `targets in ${formatDuration(totalMs)}`,
    "",
    "| Target | Result | Time |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  try {
    Deno.writeTextFileSync(path, markdown, { append: true });
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
 * Run one target: honour its `onlyWhen` conditions and the incremental cache,
 * then (if it must run) open its section, run its body, and report pass/fail.
 * A condition that fails yields `skipped`; an up-to-date target yields `cached`
 * — both unblock dependents without executing the body.
 */
async function runTarget(
  build: Build,
  reporter: Reporter,
  style: Style,
  t: TargetBuilder,
  opened: number,
  cache: BuildCache | undefined,
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
    openTarget(reporter, style, name, opened);
    failTarget(reporter, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  if (cache !== undefined && await cache.upToDate(t)) {
    return { status: "cached", ms: 0 };
  }

  openTarget(reporter, style, name, opened);
  await build.onTargetStart(name);
  const start = performance.now();

  if (!t.fn_) {
    const error = new Error(
      `Target "${name}" has no body — call .executes(...) before running.`,
    );
    failTarget(reporter, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  try {
    await t.fn_();
    const ms = performance.now() - start;
    if (cache !== undefined) await cache.record(t);
    passTarget(reporter, style, name, ms);
    return { status: "passed", ms };
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, style, name, ms, error);
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
  build: Build,
  order: TargetBuilder[],
  reporter: Reporter,
  style: Style,
  skip: Set<string>,
  cache: BuildCache | undefined,
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
    const outcome = await runTarget(build, reporter, style, t, opened, cache);
    await build.onTargetEnd(name, outcome.status);
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
  build: Build,
  order: TargetBuilder[],
  predecessors: Map<TargetBuilder, TargetBuilder[]>,
  reporter: Reporter,
  style: Style,
  skip: Set<string>,
  limit: number,
  canOverlap: (a: TargetBuilder, b: TargetBuilder) => boolean,
  cache: BuildCache | undefined,
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
        runTarget(build, buffer.reporter, style, t, flushed, cache).then(
          async (outcome) => {
            await build.onTargetEnd(t.name_ ?? "<unnamed>", outcome.status);
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
  const reporter = options.reporter ??
    (options.silent ? silentReporter : consoleReporter);
  const github = options.github ?? inGitHubActions();
  const style = resolveStyle(options, github);
  const skip = new Set(options.skip ?? []);

  // Resolve declared parameters (CLI value → environment → default) before any
  // target runs, so a target body can read `this.param.value`. A missing
  // required parameter or an invalid value fails the build before it starts.
  const params = discoverParameters(build);
  const paramErrors = resolveParameters(
    params,
    options.params ?? {},
    options.readEnv ?? defaultReadEnv,
    options.prompt ?? defaultPrompt,
  );
  if (paramErrors.length > 0) {
    reporter.error("Invalid or missing parameters:");
    for (const message of paramErrors) reporter.error(`  ${message}`);
    return {
      ok: false,
      executed: [],
      error: new ParameterError(paramErrors.join("; ")),
    };
  }
  // Under GitHub Actions, mask resolved secret values so they don't leak.
  if (style.github) {
    for (const p of params.values()) {
      const value = p.secret_ ? p.stringValue_() : undefined;
      if (value !== undefined && value !== "") {
        reporter.info(`::add-mask::${value}`);
      }
    }
  }

  const { order, predecessors } = planGraph(root);
  // Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets
  // and skip them plus any dependencies that nothing else needs.
  for (const name of await conditionSkips(root, order)) skip.add(name);

  const limit = resolveConcurrency(options.parallel);
  const globalParallel = limit > 1;
  const grouped = order.some((t) => t.group_ !== undefined);
  // `proceedAfterFailure` and `always` need the scheduler's per-target control,
  // so the simple sequential loop is only used when none of these apply.
  const scheduled = order.some((t) => t.proceedAfterFailure_ || t.always_);
  const cache = await resolveCache(options.cache, order);
  const overallStart = performance.now();

  await build.onStart();

  let run: RunOutcome;
  if (!globalParallel && !grouped && !scheduled) {
    run = await runSequential(build, order, reporter, style, skip, cache);
  } else {
    // With `--parallel`, anything independent may overlap up to `limit`.
    // Otherwise only same-group members overlap (the rest stay serialized),
    // bounded by the CPU count.
    const effectiveLimit = globalParallel ? limit : cpuCount();
    const canOverlap = globalParallel
      ? () => true
      : (a: TargetBuilder, b: TargetBuilder) =>
        a.group_ !== undefined && a.group_ === b.group_;
    run = await runScheduled(
      build,
      order,
      predecessors,
      reporter,
      style,
      skip,
      effectiveLimit,
      canOverlap,
      cache,
    );
  }
  if (cache !== undefined) await cache.save();

  const result: BuildResult = run.aborted
    ? { ok: false, executed: run.executed, error: run.failure }
    : { ok: true, executed: run.executed };

  const totalMs = performance.now() - overallStart;
  reporter.info(summaryBlock(style, run.reports, totalMs, result.ok));
  if (style.github) writeJobSummary(run.reports, totalMs, result.ok);
  await build.onFinish(result);
  return result;
}

/**
 * Resolve the incremental cache for a run: `false` disables it, a supplied
 * {@link BuildCache} is used directly, and otherwise a `.zuke/cache.json`-backed
 * cache is opened — but only when at least one target declares inputs.
 */
async function resolveCache(
  option: boolean | BuildCache | undefined,
  order: TargetBuilder[],
): Promise<BuildCache | undefined> {
  if (option === false) return undefined;
  if (typeof option === "object") return option;
  if (!order.some(isCacheable)) return undefined;
  const root = findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd();
  const storePath = absolutePath(root)(ARTIFACT_DIR, CACHE_FILE).path;
  return await openCache(storePath, defaultCacheHost);
}
