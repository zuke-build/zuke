// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `playwright test` run reports onto its target's row of the
 * build summary, read from the closing block the list, line and dot
 * reporters print — one line per category, only when non-zero:
 *
 * ```text
 *   1 failed
 *     tests/a.spec.ts:3:1 › two ───
 *   1 flaky
 *   1 skipped
 *   2 passed (1.5s)
 * ```
 *
 * Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One category line of the closing block. */
const CATEGORY =
  /^\s{0,2}(\d+) (passed|failed|flaky|skipped|did not run|interrupted)\b/gm;

/**
 * The counts from the closing block, or `undefined` when the run printed no
 * `passed` or `failed` line — a JSON or JUnit reporter, or a run that never
 * got to its tests. A test that did not run counts as skipped; an interrupted
 * one as failed.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const found = new Map<string, number>();
  for (const m of stripAnsi(output.stdout).matchAll(CATEGORY)) {
    found.set(m[2], Number(m[1]));
  }
  if (!found.has("passed") && !found.has("failed")) return undefined;
  return {
    passed: found.get("passed") ?? 0,
    failed: (found.get("failed") ?? 0) + (found.get("interrupted") ?? 0),
    skipped: (found.get("skipped") ?? 0) + (found.get("did not run") ?? 0),
    flaky: found.get("flaky") ?? 0,
  };
}
