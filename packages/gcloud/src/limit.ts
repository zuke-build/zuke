// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `--limit` gcloud accepts on a listing.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so the
 * listings that offer the flag share one rule, rather than each carrying a
 * near-copy that differs only by the task named in the message — which is the
 * shape a guard drifts out of agreement in.
 *
 * @module
 */

/**
 * Reject a limit gcloud would, which reports
 * "argument --limit: Value must be greater than or equal to 1".
 *
 * `undefined` passes: the flag is optional, and its absence is not a bad value.
 */
export function checkLimit(limit: number | undefined, task: string): void {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `GcloudTasks.${task}: .limit(${limit}) is not a count — gcloud requires ` +
        "a whole number of at least 1.",
    );
  }
}
