/**
 * Rendering a {@link "./fix.ts".Fix} for the three surfaces a fixer reports to:
 * the console, the GitHub Actions job summary, and a pull-request comment.
 *
 * @module
 */

import type { Confidence } from "./fix.ts";
import type { Usage } from "./types.ts";
import { formatUsage } from "./report.ts";

/** A fixer's outcome, summarised for the report. */
export interface FixReport {
  /** Plain-English diagnosis of the failure. */
  diagnosis: string;
  /** The underlying root cause. */
  rootCause: string;
  /** The model's confidence in the fix. */
  confidence: Confidence;
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
  const parts = [
    `## 🛠️ ${name} — \`${target}\``,
    "",
    `**Action:** ${cell(report.action)} · **Confidence:** ${report.confidence}`,
    ...(tokens !== undefined ? ["", `**Tokens:** ${tokens}`] : []),
    "",
    `**Diagnosis:** ${cell(report.diagnosis)}`,
    "",
    `**Root cause:** ${cell(report.rootCause)}`,
    "",
  ];
  if (report.files.length > 0) {
    parts.push("**Files:**", "");
    for (const f of report.files) parts.push(`- \`${cell(f)}\``);
    parts.push("");
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
