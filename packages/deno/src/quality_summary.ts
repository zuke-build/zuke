// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `deno lint`, `deno fmt` and `deno check` report onto their
 * target's row of the build summary, read from the closing lines each prints
 * on stderr: `Checked 312 files` (lint and fmt, with `Found 2 problems` or
 * `error: Found 1 not formatted file in 312 files` when there is something
 * to say), and `Found 3 errors.` or a `TS2322 [ERROR]: …` diagnostic per
 * error for `check`. Internal to the wrapper.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { SummaryPairs } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";

/** The lint/fmt closing line. */
const CHECKED = /^Checked (\d+) files?$/m;
/** `deno lint`'s problem count, printed only when non-zero. */
const PROBLEMS = /^Found (\d+) problems?$/m;
/** `deno fmt --check`'s closing line when files need formatting. */
const NOT_FORMATTED =
  /^error: Found (\d+) not formatted files? in (\d+) files?$/m;
/** `deno check`'s closing line when it found errors. */
const ERRORS = /^Found (\d+) errors?\.$/m;
/** One `deno check` diagnostic, for the single-error run with no closing line. */
const DIAGNOSTIC = /^TS\d+ \[ERROR\]:/gm;

/** The notes for a `deno lint` run: `Files` and `Problems`. */
export function parseDenoLintSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stderr);
  const checked = CHECKED.exec(text);
  if (checked === null) return undefined;
  const problems = PROBLEMS.exec(text);
  return {
    Files: Number(checked[1]),
    Problems: problems === null ? 0 : Number(problems[1]),
  };
}

/**
 * The notes for a `deno fmt` run: `Files`, plus `Unformatted` under
 * `--check`, where the closing line changes to say how many files need
 * formatting.
 */
export function parseDenoFmtSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stderr);
  const unformatted = NOT_FORMATTED.exec(text);
  if (unformatted !== null) {
    return {
      Files: Number(unformatted[2]),
      Unformatted: Number(unformatted[1]),
    };
  }
  const checked = CHECKED.exec(text);
  if (checked === null) return undefined;
  return { Files: Number(checked[1]), Unformatted: 0 };
}

/**
 * The notes for a `deno check` run: `Errors`. Deno closes a multi-error run
 * with `Found N errors.` and a single-error run with just the diagnostic, so
 * the diagnostics are counted when the closing line is absent. A run that
 * printed nothing and exited 0 is clean; one that exited non-zero without a
 * diagnostic reports nothing rather than a misleading zero.
 */
export function parseDenoCheckSummary(
  output: CommandOutput,
): SummaryPairs | undefined {
  const text = stripAnsi(output.stderr);
  const found = ERRORS.exec(text);
  if (found !== null) return { Errors: Number(found[1]) };
  const errors = [...text.matchAll(DIAGNOSTIC)].length;
  if (errors > 0 || output.code === 0) return { Errors: errors };
  return undefined;
}
