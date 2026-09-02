// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `cspell lint` run reports onto its target's row of the build
 * summary, read from the closing line it prints on stderr:
 * `CSpell: Files checked: 1000, Issues found: 4 in 3 files.`
 * Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The closing line, printed whether or not issues were found. */
const CLOSING =
  /^CSpell: Files checked: (\d+), Issues found: (\d+) in (\d+) files?\.$/m;

/**
 * The notes for a run: `Files` checked and `Issues` found. A run without
 * the closing line did not complete and reports nothing.
 */
export function parseCspellSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const m = CLOSING.exec(stripAnsi(output.stderr));
  if (m === null) return undefined;
  return { Files: Number(m[1]), Issues: Number(m[2]) };
}
