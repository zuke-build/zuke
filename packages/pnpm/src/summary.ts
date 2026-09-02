// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `pnpm install`-family run reports onto its target's row of the build
 * summary, read from the progress line pnpm settles on:
 * `Progress: resolved 120, reused 100, downloaded 20, added 120, done`, or
 * `Already up to date` when the lockfile needed nothing. Internal to the
 * wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The settled progress line. */
const PROGRESS = /^Progress: (.*), done$/m;
/** One counted phrase of the progress line. */
const COUNT = /\b(resolved|reused|downloaded|added) (\d+)/g;
/** The line printed instead when nothing needed doing. */
const UP_TO_DATE = /^Already up to date$/m;

/**
 * The notes for a run: `Added`, `Downloaded` and `Reused`. All zero for a
 * run that was already up to date; nothing for a run that printed neither
 * line, since it did not complete.
 */
export function parsePnpmSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const progress = PROGRESS.exec(text);
  if (progress === null) {
    return UP_TO_DATE.test(text)
      ? { Added: 0, Downloaded: 0, Reused: 0 }
      : undefined;
  }
  const counts = new Map<string, number>();
  for (const m of progress[1].matchAll(COUNT)) counts.set(m[1], Number(m[2]));
  return {
    Added: counts.get("added") ?? 0,
    Downloaded: counts.get("downloaded") ?? 0,
    Reused: counts.get("reused") ?? 0,
  };
}
