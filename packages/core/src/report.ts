// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Console and job-summary rendering for the executor.
 *
 * The orchestrator (`executor.ts`) decides what runs and produces a series of
 * {@link TargetReport}s; everything visual — colour, the per-target headers and
 * footers, the end-of-build summary table, the GitHub Actions `::group::`
 * commands, and the Markdown job-summary file — is shaped here so each output
 * surface stays readable on its own.
 *
 * @module
 */

import { messageOf } from "./internal.ts";
import type { TargetStatus } from "./build.ts";
import {
  escapeData,
  escapeLine,
  escapeProperty,
  formatDuration,
  line,
  paint,
  SGR,
  type Style,
} from "./render.ts";
import type { SummaryEntry } from "./summary_note.ts";

export {
  detectWidth,
  escapeData,
  escapeLine,
  escapeProperty,
  formatDuration,
  type Style,
} from "./render.ts";

/** Per-status icon shown in headers, footers, and summary rows. */
export const ICON: Record<TargetStatus, string> = {
  passed: "✔",
  failed: "✘",
  skipped: "⊘",
  cached: "⊙",
  waiting: "⏸",
};

/** Human label for a status — used in the summary table and PR comment. */
const STATUS_LABEL: Record<TargetStatus, string> = {
  passed: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cached: "Cached",
  waiting: "Waiting",
};

/** Per-status ANSI colour for the icon/label. */
const STATUS_COLOR: Record<TargetStatus, string> = {
  passed: SGR.green,
  failed: SGR.red,
  skipped: SGR.yellow,
  cached: SGR.cyan,
  waiting: SGR.magenta,
};

/** One row of the end-of-build summary. */
export interface TargetReport {
  /** The target's name. */
  name: string;
  /** The target's terminal status. */
  status: TargetStatus;
  /** The target's wall-clock duration in milliseconds. */
  ms: number;
  /**
   * The notes the target reported into its row (see
   * {@link "./target.ts".TargetContext.reportSummary}) — present only when it
   * reported at least one, so a note-less row stays `{ name, status, ms }`.
   */
  summary?: SummaryEntry[];
}

/**
 * Render a row's notes as `key: value · key: value`, or `""` for a row with
 * none — the one shape both the terminal table and the job-summary Markdown
 * print, so the two never drift.
 */
export function formatSummary(
  entries: readonly SummaryEntry[] | undefined,
): string {
  if (entries === undefined) return "";
  return entries.map((e) => `${e.key}: ${e.value}`).join(" · ");
}

/**
 * The ruled header that opens a target's section in the terminal. Two `═` rules
 * frame the target name (bold cyan), so the stream is easy to scan into blocks.
 * In GitHub Actions, a `::group::` command is used instead — the collapsible
 * group is the visual boundary there.
 */
export function targetHeader(style: Style, name: string): string[] {
  if (style.github) return [`::group::${escapeData(name)}`];
  const top = line(style);
  const label = paint(style.color, SGR.bold + SGR.cyan, name);
  return [top, label, top];
}

/** The footer printed after a target body completes (success path). */
export function targetPassFooter(
  style: Style,
  name: string,
  ms: number,
): string[] {
  const icon = paint(style.color, SGR.green, ICON.passed);
  const tail = paint(
    style.color,
    SGR.dim,
    `succeeded in ${formatDuration(ms)}`,
  );
  // A fan-out sub-target's name carries the item key, which comes from repo or
  // remote data, so on the runner's stream it is neutralised like any other
  // untrusted text.
  const safe = style.github ? escapeLine(name) : name;
  const line = `${icon} ${safe} ${tail}`;
  return style.github ? [line, "::endgroup::"] : [line];
}

/**
 * The footer printed after a target body fails. Returns `{ info, error }` lists
 * because the `::endgroup::` belongs on stdout while the annotation and the
 * error message belong on stderr, so the caller can fan them out correctly.
 */
export function targetFailFooter(
  style: Style,
  name: string,
  ms: number,
  error: unknown,
): { info: string[]; error: string[] } {
  const message = messageOf(error);
  if (!style.github) {
    return {
      info: [],
      error: [
        paint(
          style.color,
          SGR.red,
          `${ICON.failed} ${name} failed in ${formatDuration(ms)}`,
        ),
        paint(style.color, SGR.red, `  ${message}`),
      ],
    };
  }
  // Both of these are printed as themselves on a stream the runner parses for
  // commands. The message embeds a failed subprocess's stderr verbatim, which
  // is the very content escapeData's contract names as untrusted, and the name
  // can carry a fan-out item key. Escaping only the annotation below would have
  // left the detail line able to suspend command processing — and it is emitted
  // *first*, so it would have disarmed the annotation that follows it.
  const safeName = escapeLine(name);
  const safeMessage = escapeLine(message);
  return {
    info: ["::endgroup::"],
    error: [
      paint(
        style.color,
        SGR.red,
        `${ICON.failed} ${safeName} failed in ${formatDuration(ms)}`,
      ),
      paint(style.color, SGR.red, `  ${safeMessage}`),
      `::error title=${escapeProperty(name)}::${
        escapeData(`${name} failed: ${message}`)
      }`,
    ],
  };
}

/** The footer printed for a target that suspended the run at a `.waitsFor(...)` gate. */
export function targetWaitFooter(
  style: Style,
  name: string,
  trigger: string,
): string[] {
  const icon = paint(style.color, SGR.magenta, ICON.waiting);
  // The trigger describes what is being waited on, which for a workflow gate
  // names a repository and a workflow file, so it is no more ours than the
  // target name beside it.
  const safe = (text: string) => style.github ? escapeLine(text) : text;
  const note = paint(style.color, SGR.dim, `waiting for ${safe(trigger)}`);
  const line = `${icon} ${safe(name)} ${note}`;
  return style.github ? [line, "::endgroup::"] : [line];
}

/** The footer printed for a dry-run target — never actually executed. */
export function targetDryRunFooter(style: Style, name: string): string[] {
  const icon = paint(style.color, SGR.cyan, ICON.passed);
  const note = paint(style.color, SGR.dim, "(dry run — not executed)");
  const line = `${icon} ${style.github ? escapeLine(name) : name} ${note}`;
  return style.github ? [line, "::endgroup::"] : [line];
}

/**
 * The end-of-build summary block: a titled, ruled, aligned table of every
 * target's status and duration, a Total row, and a closing line stating the
 * overall result with a timestamp.
 */
export function summaryBlock(
  style: Style,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
  now: Date = new Date(),
): string[] {
  const headers = { name: "Target", status: "Status", duration: "Duration" };
  const nameWidth = reports.reduce(
    (w, r) => Math.max(w, r.name.length),
    headers.name.length,
  );
  const statusWidth = Object.values(STATUS_LABEL).reduce(
    (w, s) => Math.max(w, s.length),
    headers.status.length,
  );
  const durationWidth = Math.max(
    headers.duration.length,
    ...reports.map((r) => formatDuration(r.ms).length),
    formatDuration(totalMs).length,
  );

  const tableWidth = nameWidth + 2 + statusWidth + 2 + durationWidth;
  const divider = paint(style.color, SGR.dim, "─".repeat(tableWidth));

  const header = paint(
    style.color,
    SGR.bold,
    headers.name.padEnd(nameWidth) + "  " +
      headers.status.padEnd(statusWidth) + "  " +
      headers.duration.padStart(durationWidth),
  );

  const rows = reports.map((r) => {
    const ran = r.status === "passed" || r.status === "failed";
    const duration = ran ? formatDuration(r.ms) : "—";
    const status = paint(
      style.color,
      STATUS_COLOR[r.status],
      STATUS_LABEL[r.status].padEnd(statusWidth),
    );
    // A row's notes trail its duration NUKE-style (`// Passed: 837`), dimmed
    // so the status and timing columns stay the thing the eye lands on. They
    // are not part of the table's width: a long note overhangs the rules
    // rather than pushing every duration to the right.
    // Notes are parsed out of a tool's own output by the wrapper packages, so
    // they are the same untrusted class as the name. They need no newline to
    // matter: the legacy bracketed command form is recognised mid-line.
    const raw = formatSummary(r.summary);
    const note = style.github ? escapeLine(raw) : raw;
    const notes = note === ""
      ? ""
      : "  " + paint(style.color, SGR.dim, `// ${note}`);
    // A row starts at column 0, so a target name is the one thing here that
    // could open a command; the padding is computed from the raw name so the
    // columns stay aligned when nothing needed escaping.
    const name = style.github ? escapeLine(r.name) : r.name;
    return name + " ".repeat(Math.max(0, nameWidth - r.name.length)) + "  " +
      status + "  " +
      duration.padStart(durationWidth) + notes;
  });

  const totalLabel = paint(style.color, SGR.bold, "Total".padEnd(nameWidth));
  const totalDuration = paint(
    style.color,
    SGR.bold,
    formatDuration(totalMs).padStart(durationWidth),
  );
  const totalRow = `${totalLabel}  ${
    " ".repeat(statusWidth)
  }  ${totalDuration}`;

  const title = paint(style.color, SGR.bold, "Build Summary");
  const closing = closingLine(style, reports, totalMs, ok, now);

  return [
    "",
    title,
    divider,
    header,
    divider,
    ...rows,
    divider,
    totalRow,
    "",
    closing,
  ];
}

/** Format a {@link Date} as `YYYY-MM-DD HH:MM` in local time. */
function timestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
    pad(now.getDate())
  } ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * The closing line under the summary table — a succeeded/failed verdict, the
 * count of successful targets, the wall-clock duration, and a local timestamp.
 * On failure, names the culprits so the cause is visible in the last line.
 */
export function closingLine(
  style: Style,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
  now: Date,
): string {
  const succeeded =
    reports.filter((r) => r.status === "passed" || r.status === "cached")
      .length;
  const stamp = timestamp(now);
  const waiting = reports.filter((r) => r.status === "waiting");
  if (waiting.length > 0) {
    return paint(
      style.color,
      SGR.bold + SGR.magenta,
      `${ICON.waiting} Build suspended — ${waiting.length} target(s) waiting ` +
        `after ${formatDuration(totalMs)} · ${stamp}`,
    );
  }
  if (ok) {
    return paint(
      style.color,
      SGR.bold + SGR.green,
      `${ICON.passed} Build succeeded — ${succeeded}/${reports.length} targets ` +
        `in ${formatDuration(totalMs)} · ${stamp}`,
    );
  }
  const failed = reports.filter((r) => r.status === "failed");
  const culprit = failed.length === 1
    ? `'${style.github ? escapeLine(failed[0].name) : failed[0].name}' failed`
    : failed.length > 1
    ? `${failed.length} targets failed`
    : "no target succeeded";
  return paint(
    style.color,
    SGR.bold + SGR.red,
    `${ICON.failed} Build failed — ${culprit} after ${
      formatDuration(totalMs)
    } ` +
      `· ${stamp}`,
  );
}

/**
 * Render the GitHub Actions job-summary Markdown for a build — an aligned table
 * with a Total row and a verdict heading, mirroring the terminal summary.
 */
export function jobSummaryMarkdown(
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
): string {
  const succeeded =
    reports.filter((r) => r.status === "passed" || r.status === "cached")
      .length;
  // A Notes column only when some row has notes, so a build that reports none
  // keeps the three-column table it always had.
  const withNotes = reports.some((r) => formatSummary(r.summary) !== "");
  const notesCell = (r: TargetReport) =>
    withNotes ? ` ${formatSummary(r.summary).replaceAll("|", "\\|")} |` : "";
  const rows = reports.map((r) => {
    const ran = r.status === "passed" || r.status === "failed";
    const duration = ran ? formatDuration(r.ms) : "—";
    // A pipe in a name would otherwise open a column of its own, the way the
    // note cell already guards against.
    const name = r.name.replaceAll("|", "\\|");
    return `| ${name} | ${ICON[r.status]} ${
      STATUS_LABEL[r.status]
    } | ${duration} |${notesCell(r)}`;
  });
  return [
    `## ${ok ? "✅" : "❌"} Zuke build — ${succeeded}/${reports.length} ` +
    `targets in ${formatDuration(totalMs)}`,
    "",
    `| Target | Result | Time |${withNotes ? " Notes |" : ""}`,
    `| --- | --- | --- |${withNotes ? " --- |" : ""}`,
    ...rows,
    `| **Total** | | **${formatDuration(totalMs)}** |${withNotes ? " |" : ""}`,
    "",
  ].join("\n");
}
