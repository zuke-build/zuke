// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `tsc-alias` run reports onto its target's row of the build summary:
 * the files it rewrote, from the `tsc-alias info: 3 files were affected!`
 * line it prints under `--verbose`. Without that flag the tool prints
 * nothing, so a run reports nothing. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The verbose closing line. */
const AFFECTED = /^tsc-alias info: (\d+) files? (?:were|was) affected!$/m;

/** The notes for a verbose run: `Files`, the files rewritten. */
export function parseTscAliasSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const m = AFFECTED.exec(stripAnsi(output.stdout));
  return m === null ? undefined : { Files: Number(m[1]) };
}
