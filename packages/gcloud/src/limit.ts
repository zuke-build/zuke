// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The counts gcloud accepts on a listing, and the page counts of the Cloud
 * Monitoring reads.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so the
 * listings that offer the flag share one rule, rather than each carrying a
 * near-copy that differs only by the task named in the message — which is the
 * shape a guard drifts out of agreement in.
 *
 * @module
 */

/**
 * Reject a count that is not a whole number of at least one, naming its
 * `owner` (e.g. `GcloudTasks.buildsList`) and `setter`. gcloud reports the
 * same for `--limit` and `--page-size` ("Value must be greater than or equal
 * to 1"), and the Cloud Monitoring settings use it for their page counts.
 *
 * `undefined` passes: the setting is optional, and its absence is not a bad
 * value.
 */
export function checkCount(
  value: number | undefined,
  owner: string,
  setter: string,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${owner}: .${setter}(${value}) is not a count — use a whole number ` +
        "of at least 1.",
    );
  }
}

/** {@link checkCount} for a `GcloudTasks` command's `--limit` or `--page-size`. */
export function checkLimit(
  limit: number | undefined,
  task: string,
  setter: "limit" | "pageSize" = "limit",
): void {
  checkCount(limit, `GcloudTasks.${task}`, setter);
}
