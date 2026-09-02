// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `tsc` run reports onto its target's row of the build summary: the
 * number of diagnostics it printed. The compiler's closing `Found N errors`
 * line only appears in pretty mode (a terminal), so the diagnostics are
 * counted instead, which works piped and pretty alike:
 * `src/a.ts(3,7): error TS2322: …` or `src/a.ts:3:7 - error TS2322: …`.
 * Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One diagnostic line, in either the plain or the pretty layout. */
const DIAGNOSTIC = /\berror TS\d+:/g;

/**
 * The notes for a run: `Errors`. A run that printed no diagnostic and exited
 * 0 is clean and reports zero; one that exited non-zero without printing any
 * (a bad flag, a missing config) reports nothing rather than a misleading zero.
 */
export function parseTscSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const errors = [...stripAnsi(output.stdout).matchAll(DIAGNOSTIC)].length;
  if (errors > 0 || output.code === 0) return { Errors: errors };
  return undefined;
}
