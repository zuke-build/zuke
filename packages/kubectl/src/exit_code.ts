// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading a `kubectl` exit code as an answer rather than as a failure.
 *
 * Two commands report their result through the exit status: `kubectl diff`
 * exits 1 when it found differences, and `kubectl auth can-i` exits non-zero
 * when the action is not allowed. Neither is an error, so the readers behind
 * {@link "./kubectl.ts".KubectlTasksApi.diffHasChanges} and
 * {@link "./kubectl.ts".KubectlTasksApi.canI} suppress the throw and inspect
 * the code — while still failing the build on the codes that do mean kubectl
 * itself broke.
 *
 * Internal to the package: not exported from `mod.ts`. One implementation,
 * because getting this wrong in one of the two would turn a routine "no" into
 * a failed target.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";

/**
 * Read a two-valued answer out of an exit code.
 *
 * `no` is the code meaning the plain negative answer; 0 always means the
 * positive one. Anything else is kubectl or its differ actually failing, and
 * is raised with the command's own stderr so the build says what went wrong.
 */
export function answerFromExitCode(
  task: string,
  output: CommandOutput,
  no: number,
): boolean {
  if (output.code === 0) return true;
  if (output.code === no) return false;
  const detail = output.stderr.trim() || output.stdout.trim();
  throw new Error(
    `KubectlTasks.${task}: kubectl exited ${output.code}, which is neither ` +
      `answer it reports (0 or ${no}) — so this is a failure, not a result.` +
      (detail === "" ? "" : `\n${detail}`),
  );
}
