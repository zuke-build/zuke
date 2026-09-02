// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `shellcheck` run reports onto its target's row of the build summary:
 * the findings it printed, counted in the default `tty` layout (one
 * `In script.sh line 3:` header per finding) and in the `gcc` layout
 * (`script.sh:3:6: warning: … [SC2086]`). A clean run prints nothing and
 * exits 0. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** One finding's header in the default `tty` layout. */
const TTY_FINDING = /^In .+ line \d+:$/gm;
/** One finding in the `gcc` layout. */
const GCC_FINDING = /^.+:\d+:\d+: (?:error|warning|note): .*\[SC\d+\]$/gm;

/**
 * The notes for a run: `Findings`. Counted from whichever layout the run
 * printed; a run that printed none and exited 0 is clean, and one that exited
 * non-zero without any (a missing file, a bad flag, a layout with no lines to
 * count such as `json`) reports nothing rather than a misleading zero.
 */
export function parseShellcheckSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const findings = [...text.matchAll(TTY_FINDING)].length +
    [...text.matchAll(GCC_FINDING)].length;
  if (findings > 0 || output.code === 0) return { Findings: findings };
  return undefined;
}
