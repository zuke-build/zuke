// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link GcloudLoggingEntryCountSettings} — the settings behind
 * `GcloudTasks.logEntryCount`, which counts the log entries a
 * `gcloud logging read` filter matches.
 *
 * ```ts
 * import { GcloudTasks } from "@zuke/gcloud";
 * const errors = await GcloudTasks.logEntryCount((s) =>
 *   s.resourceType("cloud_run_revision").resourceLabel("service_name", "api")
 *     .minSeverity("ERROR").freshness("15m").limit(500).project("my-proj")
 * );
 * ```
 *
 * gcloud has no count command, so the reader reads the matching entries and
 * counts them — and two things follow from that.
 *
 * - **It counts at most `.limit(n)` entries** (default
 *   {@link DEFAULT_COUNT_LIMIT}). It reads one more than that, and when that
 *   one is there the true count is *more than* `n`: the reader fails rather
 *   than return a truncated number as if it were exact. Raise the limit when
 *   the count you need to tell apart is higher.
 * - **No payload reaches the build.** `--format` is pinned to
 *   `json(insertId)`, so gcloud prints only each entry's id; the payloads —
 *   which can carry anything an application logged, secrets included — are
 *   never captured, and a failure never quotes what was read.
 *
 * Like `gcloud logging read`, a filter with no `timestamp` in it reads only
 * the last `--freshness` — one day unless `.freshness(...)` says otherwise;
 * `.since(...)`/`.until(...)` bound the count by time instead.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GcloudLoggingReadSettings } from "./logging.ts";
import { failOnExit, type GcloudSettings } from "./settings.ts";
import { readJson } from "./scalar_output.ts";

/** The most entries the count reader reads when no `.limit(...)` is set. */
export const DEFAULT_COUNT_LIMIT = 1000;

/** The projection the count reader pins: each entry's id and nothing else. */
const COUNT_FORMAT = "json(insertId)";

/**
 * Settings for `GcloudTasks.logEntryCount`: a `gcloud logging read` whose
 * matches are counted. `.limit(n)` is the most entries counted; a count
 * above it fails as "more than n".
 */
export class GcloudLoggingEntryCountSettings extends GcloudLoggingReadSettings {
  /** The task name used in this reader's error messages. */
  protected override taskName(): string {
    return "logEntryCount";
  }
}

/**
 * Run `settings` quietly, with the count projection pinned after the
 * caller's lambdas, and return how many entries matched. `gcloud` applies
 * global flags (an account, a runner) and the instance it returns is the one
 * run. A failed exit throws even after `.noThrow()`: a reader promises a
 * number, and counting a failed command's empty output would report zero
 * errors.
 */
export async function countEntries(
  settings: GcloudLoggingReadSettings,
  task: string,
  gcloud: Configure<GcloudSettings>,
): Promise<number> {
  const limit = settings.limit_ ?? DEFAULT_COUNT_LIMIT;
  // Judge the caller's own limit before reading one past it, so a bad one is
  // refused in gcloud's terms rather than quietly made valid by the + 1.
  settings.limit(limit).argv();
  const command = gcloud(settings.limit(limit + 1)).format(COUNT_FORMAT)
    .quiet();
  const output = await command.run();
  failOnExit(command, output);
  const document = readJson(output, task);
  if (!Array.isArray(document)) {
    throw new Error(
      `${task}: gcloud did not print a list of entries. Leave --format to ` +
        "the reader, which pins it.",
    );
  }
  if (document.length > limit) {
    throw new Error(
      `${task}: more than ${limit} log entries match — the count reads at ` +
        `most .limit(${limit}), so the exact number is unknown. Raise ` +
        ".limit(...) above the count you need to tell apart, or narrow the " +
        "filter.",
    );
  }
  return document.length;
}
