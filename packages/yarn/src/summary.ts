// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `yarn install`-family run reports onto its target's row of the build
 * summary, read from the fetch-step line Yarn Berry prints:
 * `➤ YN0013: │ 2 packages were added to the project (+ 46.4 KiB).` and its
 * `removed` counterpart. Yarn Classic prints no count, so a Classic run
 * reports nothing. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One of Berry's counted fetch-step lines. */
const COUNT =
  /(\d+) packages? (?:were|was) (added to|removed from) the project/g;

/**
 * The notes for a Berry run: `Added` and `Removed`. A run that printed
 * neither line — Classic, or a Berry run that fetched nothing — reports
 * nothing.
 */
export function parseYarnSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const counts = new Map<string, number>();
  for (const m of stripAnsi(output.stdout).matchAll(COUNT)) {
    counts.set(m[2], Number(m[1]));
  }
  if (counts.size === 0) return undefined;
  return {
    Added: counts.get("added to") ?? 0,
    Removed: counts.get("removed from") ?? 0,
  };
}
