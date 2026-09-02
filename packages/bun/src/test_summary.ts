// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `bun test` run reports onto its target's row of the build
 * summary, read from the closing lines bun prints on stderr — one per
 * category, only when non-zero — followed by `Ran 4 tests across 1 file.`:
 *
 * ```text
 *  1 pass
 *  1 skip
 *  1 todo
 *  1 fail
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
const CATEGORY = /^\s*(\d+) (pass|fail|skip|todo)$/gm;
/** The line that says the run completed. */
const RAN = /^Ran \d+ tests? across \d+ files?\./m;

/**
 * The counts from the closing block, or `undefined` when the run never
 * printed its `Ran` line — it did not complete, or a reporter replaced the
 * block.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const text = stripAnsi(output.stderr);
  if (!RAN.test(text)) return undefined;
  const found = new Map<string, number>();
  for (const m of text.matchAll(CATEGORY)) found.set(m[2], Number(m[1]));
  return {
    passed: found.get("pass") ?? 0,
    failed: found.get("fail") ?? 0,
    skipped: found.get("skip") ?? 0,
    todo: found.get("todo") ?? 0,
  };
}
