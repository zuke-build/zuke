// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `dpdm` run reports onto its target's row of the build summary: the
 * circular dependencies it found, counted from the numbered entries under its
 * `• Circular Dependencies` heading, which is printed on every completed run
 * (with a congratulation line when there are none). Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The section heading every completed run prints. */
const HEADING = /^• Circular Dependencies$/m;
/** One numbered entry under it, e.g. `  1) a.js -> b.js`. */
const ENTRY = /^\s+\d+\) /gm;

/**
 * The notes for a run: `Circular`, the cycles found. Only the section under
 * the heading is counted, so a warnings section printed after it cannot
 * inflate the figure. A run without the heading did not complete and reports
 * nothing.
 */
export function parseDpdmSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stdout);
  const heading = HEADING.exec(text);
  if (heading === null) return undefined;
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.indexOf("\n•");
  const section = next === -1 ? rest : rest.slice(0, next);
  return { Circular: [...section.matchAll(ENTRY)].length };
}
