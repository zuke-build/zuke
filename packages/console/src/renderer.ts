/**
 * A {@link Renderer} implementation a build injects via
 * `run(Build, { renderer: consoleRenderer })`, so the executor's per-target
 * banners and end-of-build summary are drawn by `@zuke/console` — Zuke
 * dogfooding its own output package.
 *
 * The target header is themed (its colour comes from the {@link Theme}); the
 * footers, summary table, and job-summary Markdown reuse Zuke's canonical
 * `defaultRenderer`, so the output stays identical to a plain build unless a
 * custom theme changes it. {@link createConsoleRenderer} builds one for a given
 * palette.
 *
 * @module
 */

import { defaultRenderer, type Renderer } from "@zuke/core";
import { line, type Style, stylize } from "@zuke/core/render";
import { defaultTheme, type Theme } from "./theme.ts";

/** The ruled, theme-coloured banner that opens a target's section. */
function themedHeader(theme: Theme, style: Style, name: string): string[] {
  if (style.github) return [`::group::${name}`];
  const rule = line(style);
  const label = stylize(style.color, ["bold", ...theme.info], name);
  return [rule, label, rule];
}

/** Build a {@link Renderer} that draws target headers with `theme`'s palette. */
export function createConsoleRenderer(theme: Theme = defaultTheme): Renderer {
  return {
    targetHeader: (style, name) => themedHeader(theme, style, name),
    targetPassFooter: (style, name, ms) =>
      defaultRenderer.targetPassFooter(style, name, ms),
    targetFailFooter: (style, name, ms, error) =>
      defaultRenderer.targetFailFooter(style, name, ms, error),
    targetDryRunFooter: (style, name) =>
      defaultRenderer.targetDryRunFooter(style, name),
    summaryBlock: (style, reports, totalMs, ok) =>
      defaultRenderer.summaryBlock(style, reports, totalMs, ok),
    jobSummaryMarkdown: (reports, totalMs, ok) =>
      defaultRenderer.jobSummaryMarkdown(reports, totalMs, ok),
  };
}

/** The default console renderer, using {@link defaultTheme}. */
export const consoleRenderer: Renderer = createConsoleRenderer();
