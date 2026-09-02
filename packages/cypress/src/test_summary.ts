// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `cypress run` reports onto its target's row of the build
 * summary, summed from the `(Results)` box cypress prints after each spec:
 *
 * ```text
 *   │ Tests:        3                                                    │
 *   │ Passing:      2                                                    │
 *   │ Failing:      1                                                    │
 *   │ Pending:      0                                                    │
 *   │ Skipped:      0                                                    │
 * ```
 *
 * Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One count row of a spec's `(Results)` box. */
const ROW = /│\s+(Passing|Failing|Pending|Skipped):\s+(\d+)/g;

/**
 * The counts summed over every spec's box, or `undefined` when no box was
 * printed — a run that never started a spec, or a reporter without the box.
 * Pending tests (`it.skip`) and tests skipped after a failure both count as
 * skipped.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const totals = new Map<string, number>();
  for (const m of stripAnsi(output.stdout).matchAll(ROW)) {
    totals.set(m[1], (totals.get(m[1]) ?? 0) + Number(m[2]));
  }
  if (!totals.has("Passing")) return undefined;
  return {
    passed: totals.get("Passing") ?? 0,
    failed: totals.get("Failing") ?? 0,
    skipped: (totals.get("Pending") ?? 0) + (totals.get("Skipped") ?? 0),
  };
}
