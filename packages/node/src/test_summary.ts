// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts a `node --test` run reports onto its target's row of the build
 * summary, read from the closing block both built-in reporters print — the
 * TAP reporter node uses when piped (`# pass 1`) and the spec reporter it
 * uses on a terminal (`ℹ pass 1`): `tests`, `pass`, `fail`,
 * `cancelled`, `skipped` and `todo`. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One line of the closing block, in either reporter's prefix. */
const LINE = /^(?:#|ℹ) (pass|fail|cancelled|skipped|todo) (\d+)$/gm;

/**
 * The counts from the closing block, or `undefined` when the run printed no
 * `pass` line — a JUnit or dot reporter, or a run that never got to its
 * tests. A test cancelled because its parent failed counts as failed.
 */
export function parseTestSummary(
  output: CommandOutput,
): TestCounts | undefined {
  const found = new Map<string, number>();
  for (const m of stripAnsi(output.stdout).matchAll(LINE)) {
    found.set(m[1], Number(m[2]));
  }
  const passed = found.get("pass");
  if (passed === undefined) return undefined;
  return {
    passed,
    failed: (found.get("fail") ?? 0) + (found.get("cancelled") ?? 0),
    skipped: found.get("skipped") ?? 0,
    todo: found.get("todo") ?? 0,
  };
}
