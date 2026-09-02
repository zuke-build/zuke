// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `vitest` run reports onto its target's row of the build
 * summary, read from the closing line of the default and dot reporters:
 * `Tests  1 failed | 2 passed | 1 skipped | 1 todo (5)`. Internal to the
 * wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The `Tests` closing line: `|`-separated `N category` segments, then the total. */
const TESTS_LINE = /^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$/m;
/** One segment of the closing line. */
const SEGMENT = /^(\d+) (passed|failed|skipped|todo)$/;

/**
 * The counts from the `Tests` line, or `undefined` when the run printed
 * none — a JSON or JUnit reporter, or a run that never got to its tests. The
 * segments are read by name, so their order does not matter.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const m = TESTS_LINE.exec(stripAnsi(output.stdout));
  if (m === null) return undefined;
  const found = new Map<string, number>();
  for (const segment of m[1].split(" | ")) {
    const c = SEGMENT.exec(segment.trim());
    if (c !== null) found.set(c[2], Number(c[1]));
  }
  return {
    passed: found.get("passed") ?? 0,
    failed: found.get("failed") ?? 0,
    skipped: found.get("skipped") ?? 0,
    todo: found.get("todo") ?? 0,
  };
}
