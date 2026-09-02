// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts `deno test` prints on its result line, and how they land in a
 * build's summary row. `DenoTasks.test` reads them from the run's captured
 * stdout — the pretty and dot reporters both end with the same line — and
 * reports them through `@zuke/core`'s ambient `reportSummary`, so a `test`
 * target's row says `// Tests: 837 · Passed: 837 · Failed: 0` without the
 * build author writing a thing. Internal to the wrapper.
 *
 * @module
 */

import { stripAnsi } from "@zuke/core/render";
import type { SummaryPairs } from "@zuke/core";

/** The counts on a `deno test` result line. */
export interface DenoTestCounts {
  /** Tests that passed. */
  readonly passed: number;
  /** Tests that failed. */
  readonly failed: number;
  /** Tests marked `ignore` (deno prints the count only when it is non-zero). */
  readonly ignored: number;
}

/**
 * Deno's result line: `ok | 2 passed (2 steps) | 0 failed | 1 ignored (50ms)`
 * or `FAILED | 1 passed | 1 failed (66ms)`. `passed` and `failed` are always
 * present; `ignored`, `measured` and `filtered out` only when non-zero; each
 * of the first three may carry a `(N steps)` suffix.
 */
const RESULT_LINE =
  /^(?:ok|FAILED) \| (\d+) passed(?: \(\d+ steps?\))? \| (\d+) failed(?: \(\d+ steps?\))?(?: \| (\d+) ignored(?: \(\d+ steps?\))?)?/gm;

/**
 * The counts from the **last** result line in `stdout`, or `undefined` when
 * there is none — a JUnit or TAP reporter prints no such line, and neither
 * does a run that never got as far as running tests. The last line is deno's
 * own: it prints the result after every test's output, so a test that echoes
 * a look-alike line cannot be mistaken for it.
 */
export function parseTestSummary(stdout: string): DenoTestCounts | undefined {
  let counts: DenoTestCounts | undefined;
  for (const m of stripAnsi(stdout).matchAll(RESULT_LINE)) {
    counts = {
      passed: Number(m[1]),
      failed: Number(m[2]),
      ignored: m[3] === undefined ? 0 : Number(m[3]),
    };
  }
  return counts;
}

/**
 * The notes a test run reports into its summary row: the total the run
 * selected (passed, failed and ignored), the passed and failed counts, and the
 * ignored count only when it is non-zero — mirroring the result line itself.
 */
export function testSummaryPairs(counts: DenoTestCounts): SummaryPairs {
  const pairs: Record<string, number> = {
    Tests: counts.passed + counts.failed + counts.ignored,
    Passed: counts.passed,
    Failed: counts.failed,
  };
  if (counts.ignored > 0) pairs.Ignored = counts.ignored;
  return pairs;
}
