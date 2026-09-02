// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `dprint` run reports onto its target's row of the build summary.
 * `dprint check` closes with `Found 2 not formatted files. Run dprint fmt to
 * fix.` on stderr when files need formatting and prints nothing when they do
 * not; `dprint fmt` prints `Formatted 3 files.` on stdout when it changed
 * any. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** `dprint check`'s closing line when files need formatting. */
const NOT_FORMATTED = /^Found (\d+) not formatted files?\./m;
/** `dprint fmt`'s closing line when it changed files. */
const FORMATTED = /^Formatted (\d+) files?\./m;

/**
 * The notes for a `dprint check` run: `Unformatted`, the files that need
 * formatting. Zero when the run printed no closing line and exited 0; nothing
 * when it exited non-zero without one, since that run did not complete.
 */
export function parseDprintCheckSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const m = NOT_FORMATTED.exec(stripAnsi(output.stderr));
  if (m !== null) return { Unformatted: Number(m[1]) };
  return output.code === 0 ? { Unformatted: 0 } : undefined;
}

/**
 * The notes for a `dprint fmt` run: `Formatted`, the files it changed.
 * Zero when the run printed no closing line and exited 0; nothing when it
 * exited non-zero without one.
 */
export function parseDprintFmtSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const m = FORMATTED.exec(stripAnsi(output.stdout));
  if (m !== null) return { Formatted: Number(m[1]) };
  return output.code === 0 ? { Formatted: 0 } : undefined;
}
