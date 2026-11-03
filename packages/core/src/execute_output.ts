// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { maskPatterns, Redactor } from "./redact.ts";
import { detectWidth, type Style, type TargetReport } from "./report.ts";
import { defaultRenderer, type Renderer } from "./renderer.ts";
import { detectCiHost } from "./host.ts";
import { resolveOutputMode } from "./output_mode.ts";

/**
 * Whether terminal colour should be used: a TTY, `NO_COLOR` unset, and plain
 * output (`ZUKE_PLAIN`) not asked for — {@link resolveOutputMode}'s answer.
 */
function autoColor(readEnv?: (name: string) => string | undefined): boolean {
  return resolveOutputMode({ readEnv }).color;
}

/** Resolve the output style from the caller's overrides and the environment. */
export function resolveStyle(
  github: boolean,
  color: boolean | undefined,
  hasCustomReporter: boolean,
  readEnv?: (name: string) => string | undefined,
): Style {
  const resolved = color ??
    (github || hasCustomReporter ? false : autoColor(readEnv));
  return { github, color: resolved, width: detectWidth() };
}

/** The reporting surface a run writes through, composed once per run. */
export interface RunOutput {
  /** The redaction- and failure-wrapped reporter every run message goes through. */
  reporter: Reporter;
  /**
   * Masks each resolved `secret` parameter, and every value registered at run
   * time, in everything the run prints — and under GitHub Actions on the real
   * console emits `::add-mask::` for each (see {@link ActionsMaskingRedactor}).
   */
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
  /** The environment reader the run was given, so `ZUKE_PLAIN` is read once. */
  readEnv?: (name: string) => string | undefined;
}): RunOutput {
  const baseReporter = opts.reporter ??
    (opts.silent ? silentReporter : consoleReporter);
  // Every line Zuke prints passes through the redactor, which masks the
  // resolved value of each `secret` parameter. The redactor is populated later,
  // during parameter resolution (see `./execute_plan.ts`); since nothing
  // meaningful is reported before then, wrapping the reporter up-front is safe.
  //
  // Under GitHub Actions, writing to the real console, the redactor also emits
  // `::add-mask::` for every value it learns. Gated on `writesToConsole`: when
  // a custom reporter is supplied it *is* the base reporter, so an embedded
  // `execute()` must never be handed the raw secret. The same gate keeps the
  // job summary — a real-world side effect appended to the shared file named by
  // GITHUB_STEP_SUMMARY — out of embedded and test runs (a build's own test
  // suite calls `execute` with `silent`/a custom reporter), while a normal CLI
  // run still writes it.
  const writesToConsole = opts.reporter === undefined && !opts.silent;
  // The same question `detectCiHost` already answers, asked through it rather
  // than through a second reader of GITHUB_ACTIONS — the private copy this
  // replaces tested the identical variable for the identical value.
  const github = opts.github ?? detectCiHost() === "github";
  const redactor = github && writesToConsole
    ? new ActionsMaskingRedactor(baseReporter)
    : new Redactor();
  // …and every write is best-effort (see safeReporter): a throwing sink (a buggy
  // custom reporter, or EPIPE on a piped stdout) must never escape `failTarget`
  // and reject out of a scheduler, which would strand the run record `running`.
  const reporter = safeReporter(redactingReporter(baseReporter, redactor));
  const style = resolveStyle(
    github,
    opts.color,
    opts.reporter !== undefined,
    opts.readEnv,
  );
  const renderer = opts.renderer ?? defaultRenderer;
  return {
    reporter,
    redactor,
    writesToConsole,
    style,
    renderer,
  };
}

/**
 * A {@link Redactor} that also asks the GitHub Actions runner to mask each
 * pattern the moment it is registered, by printing `::add-mask::` to the real
 * console.
 *
 * Every route into the run's redactor — a `secret()` parameter, a wrapper's
 * `markSecret` or `markSecretsInOutput`, the engine's `secret.register` — ends
 * in {@link Redactor.add}, so emitting here covers them all from one place. The
 * redactor masks only what Zuke prints; the directive is what makes the runner
 * mask the value in a subprocess's own output too.
 *
 * The directive goes to `baseReporter`, which is not wrapped in the redactor —
 * a masked directive would hide nothing — and best-effort, so an EPIPE here
 * never aborts the run. A pattern already registered is not emitted again.
 */
export class ActionsMaskingRedactor extends Redactor {
  readonly #mask: Reporter;

  /** Emit each newly registered pattern's directive to `baseReporter`. */
  constructor(baseReporter: Reporter) {
    super();
    this.#mask = safeReporter(baseReporter);
  }

  /** Register `value` and emit `::add-mask::` for each of its new patterns. */
  override add(value: string): void {
    for (const pattern of maskPatterns(value)) {
      // Never emit a pattern that spans lines. The runner reads the directive
      // to the end of the *line*, so a multi-line value would mask only its
      // first line and print every line after it as ordinary log output — the
      // call meant to protect the secret would be the thing that leaked it.
      // maskPatterns already contributes each line separately.
      if (pattern.includes("\n")) continue;
      const before = this.size;
      super.add(pattern);
      if (this.size > before) this.#mask.info(`::add-mask::${pattern}`);
    }
    // The whole multi-line value, for the redactor alone; its lines are known.
    super.add(value);
  }
}

/**
 * Append the Markdown job-summary table to `GITHUB_STEP_SUMMARY`, if set.
 *
 * The Markdown goes through `redactor` first. Every other sink for a resolved
 * `secret()` parameter is redacted — the console through the reporter, the run
 * record as it is persisted — and this one was not, so a summary note carrying
 * a secret read `[redacted]` on the terminal and in the record while the job
 * summary published it in the clear, to everyone who can view the workflow run.
 * The `::add-mask::` directives do not cover this: they mask the runner's log
 * stream, not a file the build writes.
 */
export function writeJobSummary(
  renderer: Renderer,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
  redactor: Redactor,
): void {
  // Append, not overwrite: validations like the AI reviewers/fixer write their
  // own sections to this same file during the run, and overwriting would wipe
  // them. Best-effort — an unwritable summary must never fail the build.
  appendJobSummary(
    redactor.redact(renderer.jobSummaryMarkdown(reports, totalMs, ok)),
  );
}
