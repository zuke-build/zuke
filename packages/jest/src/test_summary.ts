// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `jest` run reports onto its target's row of the build
 * summary, read from the closing `Tests:` line jest prints on stderr:
 * `Tests:       1 failed, 1 skipped, 1 todo, 2 passed, 5 total`. Internal to
 * the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The `Tests:` closing line: comma-separated `N category` segments. */
const TESTS_LINE = /^Tests:\s+(.+)$/m;
/** One segment of the closing line. */
const SEGMENT = /^(\d+) (passed|failed|skipped|todo|total)$/;

/**
 * The counts from the `Tests:` line, or `undefined` when the run printed
 * none — a JSON reporter, or a run that never got to its tests. The segments
 * are read by name, so their order does not matter.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const m = TESTS_LINE.exec(stripAnsi(output.stderr));
  if (m === null) return undefined;
  const found = new Map<string, number>();
  for (const segment of m[1].split(",")) {
    const c = SEGMENT.exec(segment.trim());
    if (c !== null) found.set(c[2], Number(c[1]));
  }
  if (!found.has("total")) return undefined;
  return {
    passed: found.get("passed") ?? 0,
    failed: found.get("failed") ?? 0,
    skipped: found.get("skipped") ?? 0,
    todo: found.get("todo") ?? 0,
  };
}
