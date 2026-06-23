/**
 * Rendering a review {@link "./types.ts".Assessment} — to the console and to
 * the GitHub Actions job summary.
 *
 * @module
 */

import type { Assessment, Provider, Usage } from "./types.ts";
import type { RetryInfo } from "./retry.ts";

/** The settings echoed when a review starts, so the run shows what it's doing. */
export interface ReviewStart {
  /** The target being validated. */
  target: string;
  /** The model provider. */
  provider: Provider;
  /** The resolved model name. */
  model: string;
  /** A short description of the gate, e.g. `score>8`. */
  gate: string;
  /** Whether the assessment is also posted as a PR comment. */
  comment: boolean;
}

/**
 * The line announcing a review is starting, echoing its key settings so a slow
 * run reads as work-in-progress rather than a hang. For example:
 * `[security review] reviewing "deploy" — openai/gpt-5.4-mini · gate score>8 · comment`.
 */
export function reviewStartLine(name: string, start: ReviewStart): string {
  const bits = [`${start.provider}/${start.model}`, `gate ${start.gate}`];
  if (start.comment) bits.push("comment");
  return `[${name}] reviewing "${start.target}" — ${bits.join(" · ")}`;
}

/** The line announcing a retry after a transient failure. */
export function retryLine(name: string, info: RetryInfo): string {
  const delay = `${(info.delayMs / 1000).toFixed(1)}s`;
  return `[${name}] attempt ${info.attempt}/${info.attempts} failed ` +
    `(${info.reason}) — retrying in ${delay}`;
}

/** The location suffix for a finding (`file:line`, `file`, or empty). */
function location(file?: string, line?: number): string {
  if (file === undefined) return "";
  return line !== undefined ? `${file}:${line}` : file;
}

/**
 * A human token-usage line (`123 in · 45 out · 168 total`), or `undefined` when
 * the provider reported no counts.
 */
export function formatUsage(usage?: Usage): string | undefined {
  if (usage === undefined) return undefined;
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`${usage.inputTokens} in`);
  if (usage.outputTokens !== undefined) parts.push(`${usage.outputTokens} out`);
  if (usage.totalTokens !== undefined) parts.push(`${usage.totalTokens} total`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Escape `|` so a value is safe inside a Markdown table cell. */
function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

/** The console lines for an assessment. */
export function consoleLines(
  name: string,
  assessment: Assessment,
  usage?: Usage,
): string[] {
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
  const tokens = formatUsage(usage);
  if (tokens !== undefined) lines.push(`  tokens: ${tokens}`);
  return lines;
}

/** A Markdown section for the GitHub Actions job summary. */
export function toMarkdown(
  name: string,
  target: string,
  assessment: Assessment,
  usage?: Usage,
): string {
  const tokens = formatUsage(usage);
  const parts = [
    `## 🔎 ${name} — \`${target}\``,
    "",
    `**Score:** ${assessment.score}/10 · **Severity:** ${assessment.severity} · ${assessment.findings.length} finding(s)`,
    ...(tokens !== undefined ? ["", `**Tokens:** ${tokens}`] : []),
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

/** The console line announcing a skipped review. */
export function skipConsoleLine(name: string, reason: string): string {
  return `[${name}] skipped — ${reason}`;
}

/** A Markdown section announcing a skipped review, for the job summary. */
export function skipMarkdown(
  name: string,
  target: string,
  reason: string,
): string {
  return `## ⏭️ ${name} — \`${target}\`\n\n_Skipped — ${cell(reason)}._\n`;
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
