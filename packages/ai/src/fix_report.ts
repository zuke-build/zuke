/**
 * Rendering a {@link "./fix.ts".Fix} for the three surfaces a fixer reports to:
 * the console, the GitHub Actions job summary, and a pull-request comment. The
 * report leads with the offending code — each location is shown as a diff with
 * its `file:line` — rather than prose.
 *
 * @module
 */

import type { Confidence, FixLocation } from "./fix.ts";
import type { Usage } from "./types.ts";
import { formatUsage } from "./report.ts";

/** A fixer's outcome, summarised for the report. */
export interface FixReport {
  /** One-line diagnosis of the failure. */
  diagnosis: string;
  /** The underlying root cause. */
  rootCause: string;
  /** The model's confidence in the fix. */
  confidence: Confidence;
  /** The specific code locations the fix targets, with verbatim source. */
  locations: FixLocation[];
  /** The files the fix proposes or applied, in order. */
  files: string[];
  /** A human description of what the fixer did (e.g. "applied and re-ran"). */
  action: string;
  /** Token usage from the provider call, if reported. */
  usage?: Usage;
}

/** Escape `|` so a value is safe inside a Markdown table cell. */
function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/** The `file:line` (or `file:line-endLine`) label for a location. */
function locationLabel(loc: FixLocation): string {
  return loc.endLine !== undefined && loc.endLine !== loc.line
    ? `${loc.file}:${loc.line}-${loc.endLine}`
    : `${loc.file}:${loc.line}`;
}

/** Prefix each line of `text` with `sign` (a diff `-`/`+` marker). */
function signLines(sign: string, text: string): string[] {
  return text.split("\n").map((line) => `${sign}${line}`);
}

/**
 * A fenced diff for one location: a hunk header carrying the `file:line`, the
 * offending source as removed lines, and the suggestion (if any) as added ones.
 */
function locationDiff(loc: FixLocation): string {
  const suggestion = loc.suggestion ?? "";
  const body = [
    `@@ ${locationLabel(loc)} @@`,
    ...signLines("-", loc.code),
    ...(suggestion === "" ? [] : signLines("+", suggestion)),
  ];
  return ["```diff", ...body, "```"].join("\n");
}

/** The console lines describing a fix. */
export function fixConsoleLines(
  name: string,
  target: string,
  report: FixReport,
): string[] {
  const lines = [
    `[${name}] "${target}" — ${report.action} (confidence: ${report.confidence})`,
    `  ${report.diagnosis}`,
  ];
  for (const loc of report.locations) lines.push(`  @ ${locationLabel(loc)}`);
  for (const f of report.files) lines.push(`  ~ ${f}`);
  const tokens = formatUsage(report.usage);
  if (tokens !== undefined) lines.push(`  tokens: ${tokens}`);
  return lines;
}

/** The Markdown section for the job summary and the PR comment. */
export function fixMarkdown(
  name: string,
  target: string,
  report: FixReport,
): string {
  const tokens = formatUsage(report.usage);
  const meta = [
    `**Action:** ${cell(report.action)}`,
    `**Confidence:** ${report.confidence}`,
  ];
  if (tokens !== undefined) meta.push(`**Tokens:** ${tokens}`);
  const parts = [
    `## 🛠️ ${name} — \`${target}\``,
    "",
    meta.join(" · "),
    "",
    `> ${cell(report.diagnosis)}`,
    "",
  ];
  for (const loc of report.locations) {
    parts.push(`#### \`${cell(locationLabel(loc))}\``, locationDiff(loc), "");
  }
  if (report.files.length > 0) {
    const list = report.files.map((f) => `\`${cell(f)}\``).join(", ");
    parts.push(`**Files:** ${list}`, "");
  }
  return parts.join("\n");
}

/** The console line announcing a skipped fix. */
export function fixSkipConsoleLine(name: string, reason: string): string {
  return `[${name}] skipped — ${reason}`;
}

/** A Markdown section announcing a skipped fix, for the summary/comment. */
export function fixSkipMarkdown(
  name: string,
  target: string,
  reason: string,
): string {
  return `## ⏭️ ${name} — \`${target}\`\n\n_Skipped — ${cell(reason)}._\n`;
}
