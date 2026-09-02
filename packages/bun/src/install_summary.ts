// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `bun install`-family run reports onto its target's row of the build
 * summary, read from the closing line bun prints: `120 packages installed
 * [1.20s]`, `Checked 120 installs across 240 packages (no changes) [2ms]`,
 * or `1 package removed [5ms]`. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The closing line naming what changed. */
const CHANGED = /^(\d+) packages? (installed|removed)\b/m;
/** The closing line of a run that changed nothing. */
const UNCHANGED = /^Checked \d+ installs? across \d+ packages? \(no changes\)/m;

/**
 * The notes for a run: `Installed` and `Removed`. Both zero for a run that
 * changed nothing; nothing for a run that printed no closing line, since it
 * did not complete.
 */
export function parseBunInstallSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const changed = CHANGED.exec(text);
  if (changed !== null) {
    const n = Number(changed[1]);
    return changed[2] === "installed"
      ? { Installed: n, Removed: 0 }
      : { Installed: 0, Removed: n };
  }
  return UNCHANGED.test(text) ? { Installed: 0, Removed: 0 } : undefined;
}
