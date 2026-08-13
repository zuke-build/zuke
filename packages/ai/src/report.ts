// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Rendering a review {@link "./types.ts".Assessment} — to the console and to
 * the GitHub Actions job summary.
 *
 * @module
 */

import type {
  Assessment,
  AssessmentFinding,
  Provider,
  Usage,
} from "./types.ts";
import type { RetryInfo } from "./retry.ts";
import type { StoredFinding } from "./state.ts";

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

/**
 * Make a model-supplied value safe to place in the reviewer's own comment:
 * `|` escaped so it cannot break out of a Markdown table cell, and the HTML
 * comment delimiters neutralised.
 *
 * The delimiters matter far beyond cosmetics. The reviewer's comment carries
 * its durable state in a hidden `<!-- zuke-ai-state:… -->` block, and it trusts
 * that block **because the comment is its own**. But its own comment also
 * repeats model output — titles, files, summaries — and the model reads an
 * attacker-controlled diff. Left raw, a finding titled with a forged state
 * block would be published inside the reviewer's comment and read back next
 * round as authoritative, letting a PR author mark real findings dismissed.
 * Authorship of the comment is not authorship of every byte in it.
 */
function cell(value: string): string {
  return value
    .replaceAll("|", "\\|")
    .replaceAll("<!--", "&lt;!--")
    .replaceAll("-->", "--&gt;");
}

/** A model-supplied `file:line`, neutralised like any other untrusted value. */
function location(file?: string, line?: number): string {
  if (file === undefined) return "";
  return cell(line !== undefined ? `${file}:${line}` : file);
}

/**
 * Extra report context rendered alongside an assessment: cost-control and
 * suppression state that is additive to the core findings.
 */
export interface ReportExtras {
  /** Number of findings hidden by the suppress list, when any. */
  suppressed?: number;
  /**
   * The findings the suppress list hid, listed in the report so suppression is
   * auditable — it mutes the gate, it does not silently erase the record.
   */
  suppressedFindings?: AssessmentFinding[];
  /** Whether the response was served from the cache (no API call was made). */
  fromCache?: boolean;
  /** A one-line budget summary (see {@link "./budget.ts".Budget.describe_}). */
  budget?: string;
  /**
   * Candidate findings the verify pass refuted, with the verifier's reason —
   * listed so the narrowing is auditable, exactly like suppression.
   */
  refuted?: RefutedFinding[];
  /**
   * Findings dismissed through the PR discussion (a trusted rebuttal the
   * adjudication accepted), with who refuted them and why. Auditable, not
   * gating.
   */
  dismissed?: DismissedFinding[];
  /**
   * Whether the discussion feature is active — switches the finding-id hint
   * from "add to the suppress list" to "reply on the PR quoting the id".
   */
  discussion?: boolean;
  /**
   * Findings from earlier rounds that no longer reproduce against the current
   * diff — the PR's progress. Cumulative: every fixed finding stays listed, so
   * each report shows how far the PR has come.
   */
  fixed?: StoredFinding[];
  /**
   * Operational notes about the run itself — a bounded pass that did not
   * compare everything, a pass skipped for budget, a pass that failed, a
   * reopened finding. Rendered in both the console output and the PR comment:
   * a cap or a skipped check that only reaches the log reads, in the comment,
   * as "nothing matched".
   */
  notes?: string[];
}

/** A candidate finding the verify pass refuted, and why. */
export interface RefutedFinding {
  /** The refuted finding. */
  finding: AssessmentFinding;
  /** The verifier's one-line reason. */
  reason?: string;
}

/** A finding dismissed through the PR discussion. */
export interface DismissedFinding {
  /** The dismissed finding. */
  finding: AssessmentFinding;
  /** The login of the maintainer whose rebuttal was accepted. */
  author?: string;
  /** The adjudicator's one-line reason for accepting the dismissal. */
  reason?: string;
  /**
   * The earlier title this finding restates, when the dedup pass resolved it
   * onto an identity the state already held. Shown so an inherited dismissal
   * is never mistaken for a fresh one — the maintainer can see which earlier
   * decision is doing the silencing.
   */
  rewordedFrom?: string;
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
  for (const f of extras.suppressedFindings ?? []) {
    const where = location(f.file, f.line);
    const id = f.id !== undefined ? ` · ${f.id}` : "";
    lines.push(
      `    suppressed: [${f.severity}] ${f.title}${
        where === "" ? "" : ` (${where})`
      }${id}`,
    );
  }
  for (const r of extras.refuted ?? []) {
    lines.push(
      `    refuted by verify: ${r.finding.title}${
        r.reason !== undefined ? ` — ${r.reason}` : ""
      }`,
    );
  }
  for (const d of extras.dismissed ?? []) {
    const by = d.author !== undefined ? ` by ${d.author}` : "";
    const reworded = d.rewordedFrom !== undefined
      ? ` (reworded from "${d.rewordedFrom}")`
      : "";
    lines.push(
      `    dismissed via discussion${by}: ${d.finding.title}${reworded}${
        d.reason !== undefined ? ` — ${d.reason}` : ""
      }`,
    );
  }
  for (const f of extras.fixed ?? []) {
    const where = location(f.file);
    lines.push(
      `    fixed: ${f.title}${where === "" ? "" : ` (${where})`} · ${f.id}`,
    );
  }
  for (const note of extras.notes ?? []) lines.push(`  note: ${note}`);
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
    parts.push(...idHint(assessment.findings, extras.discussion === true));
  }
  parts.push(...fixedSection(extras.fixed ?? []));
  parts.push(...suppressedSection(extras.suppressedFindings ?? []));
  parts.push(...refutedSection(extras.refuted ?? []));
  parts.push(...dismissedSection(extras.dismissed ?? []));
  parts.push(...notesSection(extras.notes ?? []));
  if (assessment.summary !== "") {
    parts.push(`> ${cell(assessment.summary)}`, "");
  }
  return parts.join("\n");
}

/**
 * The run's operational notes — a bounded check that did not compare
 * everything, a pass skipped or failed, a reopened finding. Empty when the run
 * had nothing to report about itself.
 */
function notesSection(notes: string[]): string[] {
  if (notes.length === 0) return [];
  return [
    "**Notes:**",
    "",
    ...notes.map((note) => `- ${cell(note)}`),
    "",
  ];
}

/**
 * A table of the candidates the verify pass refuted, with the verifier's
 * reason — so the narrowing is auditable rather than silent. Empty when the
 * verify pass ran clean or did not run.
 */
function refutedSection(refuted: RefutedFinding[]): string[] {
  if (refuted.length === 0) return [];
  const parts = [
    "**Refuted by verification (not reported):**",
    "",
    "| Finding | Reason |",
    "| --- | --- |",
  ];
  for (const r of refuted) {
    parts.push(`| ${cell(r.finding.title)} | ${cell(r.reason ?? "—")} |`);
  }
  parts.push("");
  return parts;
}

/**
 * The line closing the dismissed section: a dismissal holds for this pull
 * request only — the committed suppress list is the cross-PR override, and it
 * stays a deliberate, reviewed edit. So the report points at it rather than
 * promoting anything itself: a finding that keeps being re-argued on PR after
 * PR is a repo-wide false positive, and its ID (in the table above) is what
 * mutes it. Exported so a test can pin the wording the docs quote.
 */
export const SUPPRESS_HINT =
  "_Dismissals apply to this pull request only. If one of these keeps coming " +
  "back on other PRs, add its ID to the suppress list in your build file " +
  '(`.suppress(suppressions((s) => s.add("…")))`) to mute it repo-wide._';

/**
 * A table of the findings dismissed through the PR discussion — who refuted
 * each one and the adjudicator's reason. Dismissal mutes the gate; this
 * section keeps the record visible so it never silently buries a finding, and
 * closes with {@link SUPPRESS_HINT} pointing at the cross-PR override.
 */
function dismissedSection(dismissed: DismissedFinding[]): string[] {
  if (dismissed.length === 0) return [];
  const parts = [
    "**Dismissed via discussion (not gating):**",
    "",
    "| Finding | Refuted by | Reason | ID |",
    "| --- | --- | --- | --- |",
  ];
  for (const d of dismissed) {
    const title = d.rewordedFrom === undefined
      ? cell(d.finding.title)
      : `${cell(d.finding.title)} _(reworded from "${cell(d.rewordedFrom)}")_`;
    parts.push(
      `| ${title} | ${cell(d.author ?? "—")} | ${cell(d.reason ?? "—")} | ${
        d.finding.id ?? "—"
      } |`,
    );
  }
  parts.push("", SUPPRESS_HINT, "");
  return parts;
}

/**
 * The PR's progress: findings from earlier rounds that no longer reproduce.
 * Cumulative across rounds, so each report shows everything resolved so far —
 * alongside the open-findings table, the thread reads as a progress log.
 * Empty when nothing has been fixed (or the discussion feature is off).
 */
function fixedSection(fixed: StoredFinding[]): string[] {
  if (fixed.length === 0) return [];
  const parts = [
    "**✅ Fixed since first review:**",
    "",
    "| Severity | Finding | Location | ID |",
    "| --- | --- | --- | --- |",
  ];
  for (const f of fixed) {
    const where = location(f.file);
    parts.push(
      `| ${f.severity} | ${cell(f.title)} | ${
        where === "" ? "—" : where
      } | ${f.id} |`,
    );
  }
  parts.push("");
  return parts;
}

/**
 * A table of the findings the suppress list hid, so a reviewer can see exactly
 * what was muted (and its ID) rather than a bare count — suppression must never
 * silently bury a finding. Empty when nothing was suppressed.
 */
function suppressedSection(findings: AssessmentFinding[]): string[] {
  if (findings.length === 0) return [];
  const parts = [
    "**Suppressed (not gating):**",
    "",
    "| Severity | Finding | Location | ID |",
    "| --- | --- | --- | --- |",
  ];
  for (const f of findings) {
    const where = location(f.file, f.line);
    parts.push(
      `| ${f.severity} | ${cell(f.title)} | ${where === "" ? "—" : where} | ${
        f.id ?? "—"
      } |`,
    );
  }
  parts.push("");
  return parts;
}

/**
 * A collapsible hint listing each finding's stable ID, so a reader can copy a
 * false positive's ID into the suppress list — or, when the discussion feature
 * is on, contest it by replying on the PR with the ID quoted. Empty when no
 * finding carries an ID (e.g. an older reviewer that did not fingerprint).
 */
function idHint(
  findings: Assessment["findings"],
  discussion: boolean,
): string[] {
  const withId = findings.filter((f) => f.id !== undefined);
  if (withId.length === 0) return [];
  const lines = [
    "<details><summary>Dismiss a false positive</summary>",
    "",
    discussion
      ? "Reply on this PR quoting a finding's ID to contest it — the reviewer " +
        "reads maintainer replies, re-checks the finding, and dismisses it when " +
        "the rebuttal holds. The suppress list still works as a hard override:"
      : "Add a finding's ID to the suppress list to hide it next time:",
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
  // Deliberately not delegating to `@zuke/core`'s `appendJobSummary`: this
  // package declares an older core floor than the release that introduced it,
  // and a consumer installing that floor from JSR would get a missing export.
  // Revisit once this package's declared floor has moved past it.
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
