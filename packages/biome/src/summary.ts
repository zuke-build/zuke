// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `biome` run reports onto its target's row of the build summary,
 * read from the closing lines every subcommand prints:
 * `Checked 120 files in 50ms. No fixes applied.`, then `Found 3 errors.`
 * and `Found 2 warnings.` when there were any. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The closing line naming how many files the run looked at. */
const CHECKED = /^Checked (\d+) files? in /m;
/** The optional line naming the errors found. */
const ERRORS = /^Found (\d+) errors?\.$/m;
/** The optional line naming the warnings found. */
const WARNINGS = /^Found (\d+) warnings?\.$/m;

/**
 * The notes for a run: `Files`, `Errors` and `Warnings`. Biome prints
 * the `Checked` line on every completed run and the `Found` lines only when
 * the count is non-zero, so a run without the `Checked` line did not
 * complete and reports nothing.
 */
export function parseBiomeSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const checked = CHECKED.exec(text);
  if (checked === null) return undefined;
  const count = (re: RegExp) => {
    const m = re.exec(text);
    return m === null ? 0 : Number(m[1]);
  };
  return {
    Files: Number(checked[1]),
    Errors: count(ERRORS),
    Warnings: count(WARNINGS),
  };
}
