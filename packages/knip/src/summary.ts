// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a `knip` run reports onto its target's row of the build summary: the
 * issues it found, summed over the sections of its default reporter —
 * `Unused files (1)`, `Unused dependencies (2)`, `Unused exports (3)` and the
 * rest. A clean run prints nothing and exits 0. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** A section heading of the default reporter, with its count. */
const SECTION = /^[A-Z][A-Za-z]*(?: [a-z]+)* \((\d+)\)$/gm;

/**
 * The notes for a run: `Issues`, the sum of every section's count. A run that
 * printed no section and exited 0 is clean; one that exited non-zero without
 * a section (a configuration error) reports nothing rather than a misleading
 * zero.
 */
export function parseKnipSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  let issues = 0;
  let sections = 0;
  for (const m of stripAnsi(output.stdout).matchAll(SECTION)) {
    issues += Number(m[1]);
    sections++;
  }
  if (sections > 0 || output.code === 0) return { Issues: issues };
  return undefined;
}
