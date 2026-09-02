// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts `deno test` prints on its result line, and how they land in a
 * build's summary row. `DenoTasks.test` reads them from the run's captured
 * stdout — the pretty and dot reporters both end with the same line — and
 * reports them through `@zuke/core`'s `reportTestCounts`, so a `test`
 * target's row says `// Tests: 837 · Passed: 837 · Failed: 0` in the shape
 * every test-runner wrapper shares. Internal to the wrapper.
 *
 * @module
 */

import { stripAnsi } from "@zuke/core/render";
import type { TestCounts } from "@zuke/core";

/**
 * Deno's result line: `ok | 2 passed (2 steps) | 0 failed | 1 ignored (50ms)`
 * or `FAILED | 1 passed | 1 failed (66ms)`. It opens with the verdict, and the
 * counts follow as ` | `-separated segments: `passed` and `failed` are always
 * printed; `ignored`, `measured` and `filtered out` only when non-zero; the
 * first three may carry a `(N steps)` suffix; and the whole line ends with the
 * run's duration in parentheses.
 */
const RESULT_LINE = /^(?:ok|FAILED) \| (.+)$/gm;

/** One count segment of the result line, e.g. `2 passed (2 steps)`. */
const SEGMENT =
  /^(\d+) (passed|failed|ignored|measured|filtered out)(?: \(\d+ steps?\))?$/;

/** The trailing `(66ms)` duration, dropped before the segments are read. */
const DURATION = / \([^()]*\)$/;

/**
 * The counts from the **last** result line in `stdout`, or `undefined` when
 * there is none — a JUnit or TAP reporter prints no such line, and neither
 * does a run that never got as far as running tests. The last line is deno's
 * own: it prints the result after every test's output, so a test that echoes
 * a look-alike line cannot be mistaken for it.
 *
 * The segments are read by name rather than by position, so the parser does
 * not depend on the order deno prints them in, nor on which of the optional
 * ones (`ignored`, `measured`, `filtered out`) a run happens to include. A
 * line without both `passed` and `failed` is not a result line.
 */
export function parseTestSummary(stdout: string): TestCounts | undefined {
  let counts: TestCounts | undefined;
  for (const m of stripAnsi(stdout).matchAll(RESULT_LINE)) {
    const found = new Map<string, number>();
    for (const segment of m[1].replace(DURATION, "").split(" | ")) {
      const c = SEGMENT.exec(segment.trim());
      if (c !== null) found.set(c[2], Number(c[1]));
    }
    const passed = found.get("passed");
    const failed = found.get("failed");
    if (passed === undefined || failed === undefined) continue;
    // Deno's `ignored` is the shared shape's `skipped`.
    counts = { passed, failed, skipped: found.get("ignored") ?? 0 };
  }
  return counts;
}
