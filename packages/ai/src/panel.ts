// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The review panel: the reviewers attached together to one target speak on
 * the pull request as one comment.
 *
 * Nothing in the build declares a panel. Core hands every validation the list
 * it was attached in (`ValidationContext.peers`), and the reviewers in one
 * unbroken run of that list that post a comment form a panel of their own
 * accord. Each member reviews as it always has, but hands its part — its
 * verdict, its findings, its full report and its discussion state — to the
 * panel instead of posting it. The last member then posts the one comment,
 * and only then lets a failure through: a member whose gate trips holds its
 * error back, so every reviewer runs and the reader gets every verdict, not
 * just the first.
 *
 * Only an unbroken run, because a member holds its error back on the promise
 * that a later one will raise it. Any other validation between two reviewers
 * could fail and end the list before that later one ran; it splits them into
 * two panels instead. A run of one is not a panel: a reviewer alone posts its
 * own comment, exactly as before.
 *
 * @module
 */

import { AiReviewError } from "./errors.ts";
import { cell, html } from "./markdown.ts";
import { location, severityLabel } from "./report.ts";
import { rank } from "./severity.ts";
import type { AssessmentFinding, AssessmentType, Severity } from "./types.ts";

/** How one member's review ended, as the panel shows it. */
export type PanelVerdict = "passed" | "minor" | "failed" | "skipped";

/** One member's part of the panel's comment. */
export interface PanelSection {
  /** The reviewer's name. */
  name: string;
  /** The reviewer's badge. */
  badge: string;
  /** How the review ended. */
  verdict: PanelVerdict;
  /** The score out of 10, when the review assessed anything. */
  score?: number;
  /** The overall severity, when the review assessed anything. */
  severity?: Severity;
  /** The findings still open, for the merged table. */
  findings: AssessmentFinding[];
  /** Why the review was skipped, for a skipped one. */
  skipped?: string;
  /** The reviewer's full report, without its heading. Redacted. */
  report: string;
  /** The reviewer's state block, tagged with its name. Redacted. */
  state?: string;
}

/** What a panel's comment marker name starts with. */
const PANEL_PREFIX = "panel:";

/** What separates the members' names in a panel's comment marker name. */
const MEMBER_SEPARATOR = " + ";

/**
 * Whether the comment marked `marker` — a reviewer's comment marker name — is
 * a panel's that `name` belongs to. A panel's comment is its members' own:
 * one that holds no state block for a member is that member having none, not
 * a reason to look further back.
 */
export function panelHas(marker: string, name: string): boolean {
  return marker.startsWith(PANEL_PREFIX) &&
    marker.slice(PANEL_PREFIX.length).split(MEMBER_SEPARATOR).includes(name);
}

/** The default badge for each kind of reviewer. */
export const BADGES: Readonly<Record<AssessmentType, string>> = {
  security: "🛡️",
  generic: "🧹",
  secrets: "🔑",
  correctness: "🐛",
  license: "⚖️",
};

/**
 * A panel being filled during one run: what each member handed in, the errors
 * they held back, and whether any of them appends rather than updates.
 */
export class Panel {
  /** The members' names, in the order they run. */
  readonly members: readonly string[];
  /** The name the panel's comment is marked with. */
  readonly name: string;
  /** Each member's part, by name, once it has reported. */
  readonly sections = new Map<string, PanelSection>();
  /** The errors the members held back, in the order they were raised. */
  readonly errors: Array<{ name: string; error: unknown }> = [];
  /** Whether any member posts in `"append"` mode. */
  append = false;

  /** A panel of the reviewers named `members`, in the order they run. */
  constructor(members: readonly string[]) {
    this.members = members;
    this.name = `${PANEL_PREFIX}${members.join(MEMBER_SEPARATOR)}`;
  }

  /**
   * The error the panel ends with, or `undefined` when no member failed: the
   * one error as it was raised, or several combined — every failing member's
   * reason, so none of them is lost behind the first.
   */
  failure(): unknown {
    if (this.errors.length === 0) return undefined;
    if (this.errors.length === 1) return this.errors[0].error;
    return new AiReviewError(
      this.errors.map(({ error }) =>
        error instanceof Error ? error.message : String(error)
      ).join("\n"),
    );
  }
}

/** Where a member sits in its panel. */
export interface PanelSeat {
  /** The panel. */
  panel: Panel;
  /** Whether this member runs last — the one that posts the comment. */
  last: boolean;
}

/** The panels of the runs in progress, by run, target and first member. */
const PANELS = new Map<string, Panel>();

/**
 * The seat of `self` in the panel its peers form, or `undefined` when it acts
 * alone: no peers, a run of one, or `self` listed more than once — a list that
 * names a validation twice runs it twice, and its two runs cannot tell which
 * seat is theirs.
 *
 * The panel itself is shared through a process-wide record keyed by `run`,
 * `target` and the first member's position, so the members of one panel —
 * separate objects, validated one after the other — reach the same one, while
 * another run, even of the same target in the same process, gets its own. The
 * first member opens it afresh, so a retried target starts empty; the last
 * member closes it with {@link closePanel}.
 */
export function seatOf<T extends { name: string }>(
  self: T,
  peers: readonly unknown[],
  member: (peer: unknown) => peer is T,
  run: string,
  target: string,
): PanelSeat | undefined {
  const at = peers.indexOf(self);
  if (at === -1 || peers.lastIndexOf(self) !== at) return undefined;
  let start = at;
  while (start > 0 && member(peers[start - 1])) start--;
  let end = at;
  while (end < peers.length - 1 && member(peers[end + 1])) end++;
  if (end === start) return undefined;
  const group = peers.slice(start, end + 1).filter(member);
  // A peer named twice inside the run would take two seats; two peers that
  // share a name would share one, each overwriting the other's part. Both act
  // alone, as two reviewers of one name always have.
  if (new Set(group).size !== group.length) return undefined;
  if (new Set(group.map((peer) => peer.name)).size !== group.length) {
    return undefined;
  }
  const key = `${run}\n${target}\n${start}`;
  let panel = PANELS.get(key);
  if (at === start || panel === undefined) {
    panel = new Panel(group.map((peer) => peer.name));
    PANELS.set(key, panel);
  }
  return { panel, last: at === end };
}

/** Forget `panel` once its comment is posted. */
export function closePanel(panel: Panel): void {
  for (const [key, open] of PANELS) {
    if (open === panel) PANELS.delete(key);
  }
}

/** How each verdict reads in the comment. */
const VERDICT_LABEL: Readonly<Record<PanelVerdict, string>> = {
  passed: "✅ passed",
  minor: "🤏 passed with findings",
  failed: "❌ failed",
  skipped: "⏭️ skipped",
};

/** The verdict a member that never reported shows. */
const UNFINISHED = "⚠️ did not finish";

/** The panel's verdict: the worst of its members'. */
function overall(panel: Panel): string {
  const verdicts = panel.members.map((name) =>
    verdictOf(panel, name) ?? "failed"
  );
  if (verdicts.includes("failed")) {
    return "❌ **Failed** — at least one reviewer's gate tripped.";
  }
  if (verdicts.includes("minor")) {
    return "🤏 **Passed with findings** — none of them trips a gate.";
  }
  const skipped = verdicts.filter((verdict) => verdict === "skipped").length;
  if (skipped === verdicts.length) {
    return "⏭️ **Skipped** — no reviewer ran.";
  }
  return skipped === 0
    ? "✅ **Passed** — no findings."
    : `✅ **Passed** — no findings; ${skipped} of ${verdicts.length} ` +
      "reviewers skipped.";
}

/**
 * A member's verdict: its own, overruled to `failed` when it also held back an
 * error, or `undefined` when it never reported.
 */
function verdictOf(panel: Panel, name: string): PanelVerdict | undefined {
  const section = panel.sections.get(name);
  if (section === undefined) return undefined;
  return panel.errors.some((e) => e.name === name) ? "failed" : section.verdict;
}

/** The verdict table: one row per member. */
function verdictTable(panel: Panel): string[] {
  const rows = [
    "| | Reviewer | Verdict | Score | Severity | Findings |",
    "| :-: | --- | --- | :-: | --- | :-: |",
  ];
  for (const name of panel.members) {
    const section = panel.sections.get(name);
    const verdict = verdictOf(panel, name);
    if (section === undefined || verdict === undefined) {
      rows.push(`| ⚠️ | ${cell(name)} | ${UNFINISHED} | — | — | — |`);
      continue;
    }
    const label = section.skipped === undefined
      ? VERDICT_LABEL[verdict]
      : `${VERDICT_LABEL[verdict]} — ${cell(section.skipped)}`;
    const score = section.score === undefined ? "—" : `${section.score}/10`;
    const findings = section.skipped === undefined
      ? String(section.findings.length)
      : "—";
    rows.push(
      `| ${cell(section.badge)} | ${cell(name)} | ${label} | ${score} | ` +
        `${section.severity ?? "—"} | ${findings} |`,
    );
  }
  return rows;
}

/**
 * The merged findings table — every member's open findings, the most severe
 * first, each naming the reviewer that raised it. Empty when there are none.
 */
function findingsTable(panel: Panel): string[] {
  const rows: Array<{ section: PanelSection; finding: AssessmentFinding }> = [];
  for (const name of panel.members) {
    const section = panel.sections.get(name);
    if (section === undefined) continue;
    for (const finding of section.findings) rows.push({ section, finding });
  }
  if (rows.length === 0) return [];
  // Stable: equal severities keep the members' order, and each member's own.
  rows.sort((a, b) => rank(b.finding.severity) - rank(a.finding.severity));
  const lines = [
    "### Findings",
    "",
    "| Reviewer | Severity | Finding | Location | Id |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const { section, finding } of rows) {
    const where = location(finding.file, finding.line);
    const id = finding.id === undefined ? "—" : `\`${finding.id}\``;
    lines.push(
      `| ${cell(section.badge)} ${cell(section.name)} | ` +
        `${severityLabel(finding)} | ` +
        `${cell(finding.title)} | ${where === "" ? "—" : where} | ${id} |`,
    );
  }
  lines.push("");
  return lines;
}

/** Each member's full report, collapsed under a summary line of its own. */
function reports(panel: Panel): string[] {
  const lines: string[] = [];
  for (const name of panel.members) {
    const section = panel.sections.get(name);
    const verdict = verdictOf(panel, name);
    if (section === undefined || verdict === undefined) continue;
    const score = section.score === undefined ? "" : ` · ${section.score}/10`;
    lines.push(
      "<details>",
      `<summary>${html(section.badge)} <b>${html(name)}</b> — ` +
        `${VERDICT_LABEL[verdict]}${score}</summary>`,
      "",
      section.report.trimEnd(),
      "",
      "</details>",
      "",
    );
  }
  return lines;
}

/**
 * The panel's comment, under the header the host adds: the verdict, a table
 * of every member's verdict, the merged findings, each member's full report
 * collapsed, and every member's state block, tagged with its name, last — so
 * nothing a report repeats can stand after the blocks it would imitate.
 */
export function renderPanel(panel: Panel, target: string): string {
  const states = panel.members.flatMap((name) => {
    const state = panel.sections.get(name)?.state;
    return state === undefined ? [] : [state];
  });
  return [
    `## 🔎 AI review — \`${target}\``,
    "",
    overall(panel),
    "",
    ...verdictTable(panel),
    "",
    ...findingsTable(panel),
    ...reports(panel),
    ...states,
  ].join("\n");
}
