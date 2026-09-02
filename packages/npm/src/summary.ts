// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What an `npm install`-family run reports onto its target's row of the build
 * summary, read from the closing line npm prints on every completed
 * dependency command: `added 120 packages, and audited 121 packages in 4s`,
 * `removed 1 package in 213ms`, `changed 3 packages …`, or `up to date in
 * 206ms` — plus `found 0 vulnerabilities` when it audited. Internal to the
 * wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The closing line, which starts with the first of its counted phrases. */
const CLOSING =
  /^(?:added|removed|changed|up to date)\b.*\bin \d+(?:\.\d+)?m?s$/m;
/** One counted phrase of the closing line. */
const COUNT = /\b(added|removed|changed) (\d+) packages?/g;
/** The audit line, printed when the command audited. */
const VULNERABILITIES = /^found (\d+) vulnerabilit(?:y|ies)/m;

/**
 * The notes for a run: `Added`, `Removed` and `Changed` (zero when the
 * closing line names none, as `up to date` does), plus `Vulnerabilities`
 * when the run audited. A run without the closing line did not complete and
 * reports nothing.
 */
export function parseNpmSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const closing = CLOSING.exec(text);
  if (closing === null) return undefined;
  const counts = new Map<string, number>();
  for (const m of closing[0].matchAll(COUNT)) counts.set(m[1], Number(m[2]));
  const pairs: Record<string, number> = {
    Added: counts.get("added") ?? 0,
    Removed: counts.get("removed") ?? 0,
    Changed: counts.get("changed") ?? 0,
  };
  const audit = VULNERABILITIES.exec(text);
  if (audit !== null) pairs.Vulnerabilities = Number(audit[1]);
  return pairs;
}
