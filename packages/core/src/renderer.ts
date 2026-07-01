/**
 * The {@link Renderer} seam: the executor draws every banner through this
 * interface, so a build can swap the look of its output without touching the
 * orchestrator. {@link defaultRenderer} is the built-in implementation (the
 * ruled headers and summary table in `./report.ts`); `@zuke/console` ships an
 * alternative that a build injects via `run(Build, { renderer })`.
 *
 * @module
 */

import type { Style } from "./render.ts";
import {
  jobSummaryMarkdown,
  summaryBlock,
  targetDryRunFooter,
  targetFailFooter,
  targetHeader,
  targetPassFooter,
  type TargetReport,
} from "./report.ts";

export type { TargetReport } from "./report.ts";

/**
 * How the executor renders a build's output. Each method is pure — it returns
 * the lines to print rather than writing them — so a custom renderer stays
 * unit-testable and the executor keeps control of the output streams.
 */
export interface Renderer {
  /** The banner that opens a target's section (a `::group::` under Actions). */
  targetHeader(style: Style, name: string): string[];
  /** The footer printed after a target body succeeds. */
  targetPassFooter(style: Style, name: string, ms: number): string[];
  /**
   * The footer printed after a target body fails, split into `info` (stdout)
   * and `error` (stderr) so the caller can fan the lines out correctly.
   */
  targetFailFooter(
    style: Style,
    name: string,
    ms: number,
    error: unknown,
  ): { info: string[]; error: string[] };
  /** The footer printed for a dry-run target that was never executed. */
  targetDryRunFooter(style: Style, name: string): string[];
  /** The end-of-build summary block: the aligned table and closing verdict. */
  summaryBlock(
    style: Style,
    reports: TargetReport[],
    totalMs: number,
    ok: boolean,
  ): string[];
  /** The GitHub Actions job-summary Markdown mirroring the terminal summary. */
  jobSummaryMarkdown(
    reports: TargetReport[],
    totalMs: number,
    ok: boolean,
  ): string;
}

/** The built-in renderer: Zuke's ruled headers and summary table. */
export const defaultRenderer: Renderer = {
  targetHeader,
  targetPassFooter,
  targetFailFooter,
  targetDryRunFooter,
  summaryBlock: (style, reports, totalMs, ok) =>
    summaryBlock(style, reports, totalMs, ok),
  jobSummaryMarkdown,
};
