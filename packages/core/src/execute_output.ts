/**
 * The reporting surface of one run: the sink a run writes through, the redactor
 * that masks resolved secrets in everything it prints, the resolved
 * colour/width/Actions style, and the renderer that draws banners and summaries.
 *
 * Composed once per run by {@link composeOutput} so {@link
 * "./executor.ts".execute} reads as orchestration rather than wiring. Visual
 * rendering itself lives in `./report.ts` / `./renderer.ts`; this module only
 * decides which sink and style a run gets.
 *
 * @module
 */

import {
  consoleReporter,
  redactingReporter,
  type Reporter,
  safeReporter,
  silentReporter,
} from "./reporter.ts";
import { appendJobSummary } from "./job_summary.ts";
import { Redactor } from "./redact.ts";
import { detectWidth, type Style, type TargetReport } from "./report.ts";
import { defaultRenderer, type Renderer } from "./renderer.ts";

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

/** Resolve the output style from the caller's overrides and the environment. */
export function resolveStyle(
  github: boolean,
  color: boolean | undefined,
  hasCustomReporter: boolean,
): Style {
  const resolved = color ?? (github || hasCustomReporter ? false : autoColor());
  return { github, color: resolved, width: detectWidth() };
}

/** The reporting surface a run writes through, composed once per run. */
export interface RunOutput {
  /** The caller's (or default) sink, unwrapped — only the mask directives use it. */
  baseReporter: Reporter;
  /** The redaction- and failure-wrapped reporter every run message goes through. */
  reporter: Reporter;
  /** Masks each resolved `secret` parameter in everything the run prints. */
  redactor: Redactor;
  /** Whether output reaches the real console (not silenced, not redirected). */
  writesToConsole: boolean;
  /** The resolved colour/width/Actions output style. */
  style: Style;
  /** The banner/summary renderer. */
  renderer: Renderer;
}

/** Compose the run's reporting surface: sink, redactor, style, renderer. */
export function composeOutput(opts: {
  reporter?: Reporter;
  silent?: boolean;
  github?: boolean;
  color?: boolean;
  renderer?: Renderer;
}): RunOutput {
  const baseReporter = opts.reporter ??
    (opts.silent ? silentReporter : consoleReporter);
  // Every line Zuke prints passes through the redactor, which masks the
  // resolved value of each `secret` parameter. The redactor is populated later,
  // during parameter resolution (see `./execute_plan.ts`); since nothing
  // meaningful is reported before then, wrapping the reporter up-front is safe.
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
  const writesToConsole = opts.reporter === undefined && !opts.silent;
  const github = opts.github ?? inGitHubActions();
  const style = resolveStyle(github, opts.color, opts.reporter !== undefined);
  const renderer = opts.renderer ?? defaultRenderer;
  return {
    baseReporter,
    reporter,
    redactor,
    writesToConsole,
    style,
    renderer,
  };
}

/**
 * Emit `::add-mask::` for each secret so the Actions runner masks it too.
 *
 * Under GitHub Actions, also emit `::add-mask::` with the real value so the
 * runner masks it in its own logs. This goes through the base reporter, which
 * is not wrapped in the redactor — a masked directive would hide nothing. Gate
 * it on `writesToConsole` too: when a custom reporter is supplied it *is* the
 * base reporter, so an embedded `execute()` must never be handed the raw
 * secret — only the real runner stdout should receive the directive.
 */
export function emitActionsMasks(
  values: Iterable<string>,
  baseReporter: Reporter,
): void {
  const maskReporter = safeReporter(baseReporter);
  for (const value of values) {
    // Straight to the base reporter (not redacted, so the directive works),
    // but best-effort: an EPIPE here must not abort the run either.
    maskReporter.info(`::add-mask::${value}`);
  }
}

/** Append the Markdown job-summary table to `GITHUB_STEP_SUMMARY`, if set. */
export function writeJobSummary(
  renderer: Renderer,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
): void {
  // Append, not overwrite: validations like the AI reviewers/fixer write their
  // own sections to this same file during the run, and overwriting would wipe
  // them. Best-effort — an unwritable summary must never fail the build.
  appendJobSummary(renderer.jobSummaryMarkdown(reports, totalMs, ok));
}
