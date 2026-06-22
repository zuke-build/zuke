/**
 * Rendering a review {@link "./types.ts".Assessment} — to the console and to
 * the GitHub Actions job summary.
 *
 * @module
 */

import type { Assessment } from "./types.ts";

/** The location suffix for a finding (`file:line`, `file`, or empty). */
function location(file?: string, line?: number): string {
  if (file === undefined) return "";
  return line !== undefined ? `${file}:${line}` : file;
}

/** Escape `|` so a value is safe inside a Markdown table cell. */
function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/** The console lines for an assessment. */
export function consoleLines(name: string, assessment: Assessment): string[] {
  const lines = [
    `[${name}] score ${assessment.score}/10 (${assessment.severity}) — ${assessment.findings.length} finding(s)`,
  ];
  for (const f of assessment.findings) {
    const where = location(f.file, f.line);
    lines.push(
      `  - [${f.severity}] ${f.title}${where === "" ? "" : ` (${where})`}`,
    );
  }
  if (assessment.summary !== "") lines.push(`  ${assessment.summary}`);
  return lines;
}

/** A Markdown section for the GitHub Actions job summary. */
export function toMarkdown(
  name: string,
  target: string,
  assessment: Assessment,
): string {
  const parts = [
    `## 🔎 ${name} — \`${target}\``,
    "",
    `**Score:** ${assessment.score}/10 · **Severity:** ${assessment.severity} · ${assessment.findings.length} finding(s)`,
    "",
  ];
  if (assessment.findings.length > 0) {
    parts.push("| Severity | Finding | Location |", "| --- | --- | --- |");
    for (const f of assessment.findings) {
      const where = location(f.file, f.line);
      parts.push(
        `| ${f.severity} | ${cell(f.title)} | ${where === "" ? "—" : where} |`,
      );
    }
    parts.push("");
  }
  if (assessment.summary !== "") {
    parts.push(`> ${cell(assessment.summary)}`, "");
  }
  return parts.join("\n");
}

/**
 * Append `markdown` to the GitHub Actions job-summary file, if one is set.
 * Best-effort: a missing or unwritable file never fails the review.
 */
export function writeStepSummary(markdown: string): void {
  let path: string | undefined;
  try {
    path = Deno.env.get("GITHUB_STEP_SUMMARY");
  } catch {
    return; // no env access — nothing to write to
  }
  if (path === undefined || path === "") return;
  try {
    Deno.writeTextFileSync(path, `${markdown}\n`, { append: true });
  } catch {
    // Best-effort: an unwritable summary file must never fail the review.
  }
}
