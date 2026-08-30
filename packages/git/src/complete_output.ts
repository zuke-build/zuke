// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Refusing to parse output that was captured incompletely.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so every
 * reader that parses git's output shares one check, rather than each deciding
 * separately whether a partial capture is worth mentioning.
 *
 * The capture cap matters more here than a size limit usually would, because of
 * *which* bytes it keeps. Capture retains the **newest** bytes: past the cap the
 * oldest are dropped. So a truncated capture is not a listing missing its tail —
 * it is one missing its head, cut mid-record. For a reader that groups fields by
 * position, every record after the cut then shifts, and a ref name is read as an
 * object name. The result is not an obviously short list a caller might notice;
 * it is a plausible list of wrong values.
 *
 * A blob is the case that reaches the cap first: the default is 8 MiB, and
 * returning the last 8 MiB of a larger file as if it were the file is exactly
 * the confident wrong answer these readers exist to avoid.
 *
 * @module
 */

/** The part of a finished command this check reads. */
export interface CapturedOutput {
  /** Whether either captured stream hit the cap and lost its oldest bytes. */
  truncated: boolean;
  /** The per-stream capture cap that applied, in bytes. */
  maxCapturedBytes: number;
}

/**
 * Raise when the command's output was truncated, naming the task and the cap
 * that applied, so a caller can raise it for the one command whose whole
 * output they must parse.
 */
export function requireCompleteOutput(
  output: CapturedOutput,
  task: string,
): void {
  if (!output.truncated) return;
  throw new Error(
    `GitTasks.${task}: git produced more output than the ${output.maxCapturedBytes}` +
      "-byte capture cap kept, and capture drops the oldest bytes — so what " +
      "survives begins mid-record and would parse into plausible but wrong " +
      "values. Raise the cap with .maxCapturedBytes(bytes) for this call, or " +
      "narrow what git is asked for.",
  );
}
