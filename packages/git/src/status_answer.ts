// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading a yes/no answer out of a git command's exit status.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so the
 * commands that answer this way — `merge-base --is-ancestor`, `check-ignore
 * -q`, `merge-tree` — share one reading of what a status means, rather than
 * each carrying its own copy of the same three-way branch.
 *
 * The three-way part is the whole point. These commands spend `0` on yes and
 * `1` on no, so the obvious `code === 0` looks right; but a `1` is not always a
 * "no". `merge-base` exits `128` when a revision does not name an object, and
 * `merge-tree` exits `1` — the same status as a genuine conflict — when it
 * cannot resolve one at all. Collapsing those into "no" turns a typo into a
 * confident wrong answer that a build then acts on.
 *
 * @module
 */

/**
 * The part of a finished command this module reads. Narrower than
 * `CommandOutput` on purpose: interpreting a status needs the status, and the
 * streams only to explain a failure.
 */
export interface GitRunOutcome {
  /** The process exit code. */
  code: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
}

/** How one command's statuses map onto an answer. */
export interface StatusAnswerOptions {
  /** The task named in the error, e.g. `"isAncestor"`. */
  task: string;
  /** What the command failed at, e.g. `"git merge-base --is-ancestor"`. */
  command: string;
  /**
   * Require output on stdout before reading a `1` as "no".
   *
   * `merge-tree` needs this: a real conflict still performs a merge and writes
   * the resulting tree's object name, while a revision it cannot resolve exits
   * with the same `1` and prints nothing. Without the check the second reads as
   * the first.
   */
  noRequiresOutput?: boolean;
}

/**
 * Read a yes/no answer from a finished command, raising when the status is
 * neither.
 *
 * `0` is yes and `1` is no; anything else is the command failing rather than
 * answering, and is raised with whatever it put on stderr so the cause is not
 * lost. With {@link StatusAnswerOptions.noRequiresOutput}, a `1` that produced
 * no stdout is treated as a failure too.
 */
export function yesNoFromStatus(
  outcome: GitRunOutcome,
  options: StatusAnswerOptions,
): boolean {
  if (outcome.code === 0) return true;
  const answeredNo = outcome.code === 1 &&
    (!options.noRequiresOutput || outcome.stdout.trim() !== "");
  if (answeredNo) return false;
  const detail = outcome.stderr.trim();
  throw new Error(
    `GitTasks.${options.task}: ${options.command} exited ${outcome.code} ` +
      "without answering, so this is a failure rather than a verdict" +
      `${detail === "" ? "" : `: ${detail}`}`,
  );
}
