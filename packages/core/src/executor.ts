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

import type { Build, BuildResult } from "./build.ts";
import { plan } from "./graph.ts";
import type { TargetBuilder } from "./target.ts";

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

/** A target's outcome, collected for the end-of-build summary. */
type TargetStatus = "passed" | "failed" | "skipped";

interface TargetReport {
  name: string;
  status: TargetStatus;
  ms: number;
}

const ICON: Record<TargetStatus, string> = {
  passed: "✔",
  failed: "✘",
  skipped: "⊘",
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
    const right = x.status === "skipped" ? "skipped" : formatDuration(x.ms);
    return `  ${icon} ${x.name.padEnd(width)}  ${right}`;
  });
  const passed = reports.filter((x) => x.status === "passed").length;
  const banner = paint(
    style.color,
    SGR.bold + (ok ? SGR.green : SGR.red),
    `${ok ? ICON.passed : ICON.failed} ${ok ? "SUCCESS" : "FAILED"} — ` +
      `${passed}/${reports.length} targets in ${formatDuration(totalMs)}`,
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

  const passed = reports.filter((x) => x.status === "passed").length;
  const rows = reports.map((x) => {
    const time = x.status === "skipped" ? "—" : formatDuration(x.ms);
    return `| ${x.name} | ${ICON[x.status]} ${x.status} | ${time} |`;
  });
  const markdown = [
    `## ${ok ? "✅" : "❌"} Zuke build — ${passed}/${reports.length} ` +
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

/**
 * Execute the requested target and its transitive dependencies.
 *
 * Runs the build's `onStart`/`onFinish` lifecycle hooks around the plan. Stops
 * at the first target that throws, reports it, marks the unreached targets as
 * skipped, and returns a failing result.
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

  const order = plan(root);
  const reports: TargetReport[] = [];
  const executed: string[] = [];
  const overallStart = performance.now();

  await build.onStart();

  let failure: unknown;
  let aborted = false;
  let opened = 0;

  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";

    if (skip.has(name) || aborted) {
      reports.push({ name, status: "skipped", ms: 0 });
      continue;
    }

    openTarget(reporter, style, name, opened);
    opened++;
    const start = performance.now();

    if (!t.fn_) {
      const error = new Error(
        `Target "${name}" has no body — call .executes(...) before running.`,
      );
      failTarget(reporter, style, name, 0, error);
      reports.push({ name, status: "failed", ms: 0 });
      failure = error;
      aborted = true;
      continue;
    }

    try {
      await t.fn_();
      const ms = performance.now() - start;
      passTarget(reporter, style, name, ms);
      reports.push({ name, status: "passed", ms });
      executed.push(name);
    } catch (error) {
      const ms = performance.now() - start;
      failTarget(reporter, style, name, ms, error);
      reports.push({ name, status: "failed", ms });
      failure = error;
      aborted = true;
    }
  }

  const result: BuildResult = aborted
    ? { ok: false, executed, error: failure }
    : { ok: true, executed };

  const totalMs = performance.now() - overallStart;
  reporter.info(summaryBlock(style, reports, totalMs, result.ok));
  if (style.github) writeJobSummary(reports, totalMs, result.ok);
  await build.onFinish(result);
  return result;
}
