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

import type { TargetStatus } from "./build.ts";
import { formatDuration, line, paint, SGR, type Style } from "./render.ts";

export { detectWidth, formatDuration, type Style } from "./render.ts";

/** Per-status icon shown in headers, footers, and summary rows. */
export const ICON: Record<TargetStatus, string> = {
  passed: "✔",
  failed: "✘",
  skipped: "⊘",
  cached: "⊙",
};

/** Human label for a status — used in the summary table and PR comment. */
const STATUS_LABEL: Record<TargetStatus, string> = {
  passed: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cached: "Cached",
};

/** Per-status ANSI colour for the icon/label. */
const STATUS_COLOR: Record<TargetStatus, string> = {
  passed: SGR.green,
  failed: SGR.red,
  skipped: SGR.yellow,
  cached: SGR.cyan,
};

/** One row of the end-of-build summary. */
export interface TargetReport {
  name: string;
  status: TargetStatus;
  ms: number;
}

/**
 * The ruled header that opens a target's section in the terminal. Two `═` rules
 * frame the target name (bold cyan), so the stream is easy to scan into blocks.
 * In GitHub Actions, a `::group::` command is used instead — the collapsible
 * group is the visual boundary there.
 */
export function targetHeader(style: Style, name: string): string[] {
  if (style.github) return [`::group::${name}`];
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
  const line = `${icon} ${name} ${tail}`;
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
  const message = error instanceof Error ? error.message : String(error);
  const line = paint(
    style.color,
    SGR.red,
    `${ICON.failed} ${name} failed in ${formatDuration(ms)}`,
  );
  const detail = paint(style.color, SGR.red, `  ${message}`);
  if (!style.github) return { info: [], error: [line, detail] };
  return {
    info: ["::endgroup::"],
    error: [line, detail, `::error title=${name}::${name} failed: ${message}`],
  };
}

/** The footer printed for a dry-run target — never actually executed. */
export function targetDryRunFooter(style: Style, name: string): string[] {
  const icon = paint(style.color, SGR.cyan, ICON.passed);
  const note = paint(style.color, SGR.dim, "(dry run — not executed)");
  const line = `${icon} ${name} ${note}`;
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
    return r.name.padEnd(nameWidth) + "  " +
      status + "  " +
      duration.padStart(durationWidth);
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
    ? `'${failed[0].name}' failed`
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
  const rows = reports.map((r) => {
    const ran = r.status === "passed" || r.status === "failed";
    const duration = ran ? formatDuration(r.ms) : "—";
    return `| ${r.name} | ${ICON[r.status]} ${
      STATUS_LABEL[r.status]
    } | ${duration} |`;
  });
  return [
    `## ${ok ? "✅" : "❌"} Zuke build — ${succeeded}/${reports.length} ` +
    `targets in ${formatDuration(totalMs)}`,
    "",
    "| Target | Result | Time |",
    "| --- | --- | --- |",
    ...rows,
    `| **Total** | | **${formatDuration(totalMs)}** |`,
    "",
  ].join("\n");
}
