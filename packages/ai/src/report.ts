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

/**
 * Extra report context rendered alongside an assessment: cost-control and
 * suppression state that is additive to the core findings.
 */
export interface ReportExtras {
  /** Number of findings hidden by the suppress list, when any. */
  suppressed?: number;
  /** Whether the response was served from the cache (no API call was made). */
  fromCache?: boolean;
  /** A one-line budget summary (see {@link "./budget.ts".Budget.describe_}). */
  budget?: string;
}

/** The console lines for an assessment. */
export function consoleLines(
  name: string,
  assessment: Assessment,
  usage?: Usage,
  extras: ReportExtras = {},
): string[] {
  const lines = [
    `[${name}] score ${assessment.score}/10 (${assessment.severity}) — ${assessment.findings.length} finding(s)`,
  ];
  for (const f of assessment.findings) {
    const where = location(f.file, f.line);
    const id = f.id !== undefined ? ` · ${f.id}` : "";
    lines.push(
      `  - [${f.severity}] ${f.title}${where === "" ? "" : ` (${where})`}${id}`,
    );
  }
  if (assessment.summary !== "") lines.push(`  ${assessment.summary}`);
  const tokens = formatUsage(usage);
  if (tokens !== undefined) lines.push(`  tokens: ${tokens}`);
  if (extras.fromCache) lines.push("  (cached — no API call)");
  if (extras.suppressed) {
    lines.push(
      `  suppressed ${extras.suppressed} finding(s) via the suppress list`,
    );
  }
  if (extras.budget !== undefined) lines.push(`  budget: ${extras.budget}`);
  return lines;
}

/** A Markdown section for the GitHub Actions job summary. */
export function toMarkdown(
  name: string,
  target: string,
  assessment: Assessment,
  usage?: Usage,
  extras: ReportExtras = {},
): string {
  const tokens = formatUsage(usage);
  const parts = [
    `## 🔎 ${name} — \`${target}\``,
    "",
    `**Score:** ${assessment.score}/10 · **Severity:** ${assessment.severity} · ${assessment.findings.length} finding(s)`,
    ...(tokens !== undefined ? ["", `**Tokens:** ${tokens}`] : []),
    ...(extras.budget !== undefined
      ? ["", `**Budget:** ${extras.budget}`]
      : []),
    ...(extras.suppressed
      ? [
        "",
        `**Suppressed:** ${extras.suppressed} finding(s) via the suppress list`,
      ]
      : []),
    ...(extras.fromCache ? ["", "_Served from cache — no API call._"] : []),
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
    parts.push(...idHint(assessment.findings));
  }
  if (assessment.summary !== "") {
    parts.push(`> ${cell(assessment.summary)}`, "");
  }
  return parts.join("\n");
}

/**
 * A collapsible hint listing each finding's stable ID, so a reader can copy a
 * false positive's ID into the suppress list. Empty when no finding carries an
 * ID (e.g. an older reviewer that did not fingerprint).
 */
function idHint(findings: Assessment["findings"]): string[] {
  const withId = findings.filter((f) => f.id !== undefined);
  if (withId.length === 0) return [];
  const lines = [
    "<details><summary>Dismiss a false positive</summary>",
    "",
    "Add a finding's ID to the suppress list to hide it next time:",
    "",
  ];
  for (const f of withId) lines.push(`- \`${f.id}\` — ${cell(f.title)}`);
  lines.push("</details>", "");
  return lines;
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
