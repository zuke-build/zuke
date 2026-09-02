// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What an `eslint` run reports onto its target's row of the build summary,
 * read from the closing line of the default (stylish) formatter:
 * `✖ 5 problems (2 errors, 3 warnings)`. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The stylish formatter's closing line; singular and plural nouns alike. */
const PROBLEMS = /^✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/m;

/**
 * The notes for a run: `Problems`, `Errors` and `Warnings` from the closing
 * line, or all zero when a clean run printed nothing and exited 0. A run that
 * exited non-zero without the line (a configuration error, a formatter that
 * prints no summary) reports nothing rather than a misleading zero.
 */
export function parseEslintSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const m = PROBLEMS.exec(stripAnsi(output.stdout));
  if (m !== null) {
    return {
      Problems: Number(m[1]),
      Errors: Number(m[2]),
      Warnings: Number(m[3]),
    };
  }
  return output.code === 0
    ? { Problems: 0, Errors: 0, Warnings: 0 }
    : undefined;
}
