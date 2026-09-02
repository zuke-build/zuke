// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What an `oxlint` run reports onto its target's row of the build summary.
 * On a terminal oxlint closes with `Found 3 warnings and 1 error.` (and
 * `Finished in 12ms on 40 files …`); piped, it prints one
 * `path:line:col: warning rule: message` line per diagnostic and no closing
 * line, so those are counted instead. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The terminal reporter's closing line. */
const FOUND = /^Found (\d+) warnings? and (\d+) errors?\.$/m;
/** The terminal reporter's timing line, which carries the file count. */
const FINISHED = /^Finished in \S+ on (\d+) files?\b/m;
/** One diagnostic of the piped (non-terminal) reporter. */
const DIAGNOSTIC = /^.+:\d+:\d+: (warning|error)\b/gm;

/**
 * The notes for a run: `Errors` and `Warnings`, plus `Files` when the
 * timing line names them. Read from the closing line when there is one, else
 * counted from the per-diagnostic lines; a clean run that printed nothing and
 * exited 0 reports zeros, and a non-zero exit with no diagnostics reports
 * nothing rather than a misleading zero.
 */
export function parseOxlintSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const files = FINISHED.exec(text);
  const withFiles = (pairs: Record<string, number>): SummaryPairs =>
    files === null ? pairs : { ...pairs, Files: Number(files[1]) };
  const found = FOUND.exec(text);
  if (found !== null) {
    return withFiles({ Errors: Number(found[2]), Warnings: Number(found[1]) });
  }
  let errors = 0;
  let warnings = 0;
  for (const m of text.matchAll(DIAGNOSTIC)) {
    if (m[1] === "error") errors++;
    else warnings++;
  }
  if (errors + warnings > 0 || output.code === 0) {
    return withFiles({ Errors: errors, Warnings: warnings });
  }
  return undefined;
}
