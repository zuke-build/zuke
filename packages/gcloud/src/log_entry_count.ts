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
 * A count always has a lower time bound. Without `.since(...)` or
 * `.freshness(...)` it counts the last day — gcloud's own default — but sent
 * as an explicit `timestamp>=` in the filter, because gcloud silently drops
 * its default whenever the filter's text mentions `timestamp`, and the count
 * would then span the whole retention period.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GcloudOutputError } from "./errors.ts";
import { GcloudLoggingReadSettings } from "./logging.ts";
import { failOnExit, type GcloudSettings } from "./settings.ts";
import { readJson } from "./scalar_output.ts";

/** The most entries the count reader reads when no `.limit(...)` is set. */
export const DEFAULT_COUNT_LIMIT = 1000;

/** How far back a count reaches with no `.since(...)` or `.freshness(...)`. */
const DEFAULT_COUNT_FRESHNESS = "1d";

/**
 * The flags the count reader pins, which a caller's `.flag(...)` or
 * `.args(...)` would otherwise override: gcloud takes the last value, so a
 * second `--limit` could cut the read short and a second `--format` print
 * payloads. `--flags-file` could set either from a file.
 */
const PINNED = /^--(?:limit|format|flags-file)(?:=|$)/;

/** The projection the count reader pins: each entry's id and nothing else. */
const COUNT_FORMAT = "json(insertId)";

/**
 * Settings for `GcloudTasks.logEntryCount`: a `gcloud logging read` whose
 * matches are counted. `.limit(n)` is the most entries counted; a count
 * above it fails as "more than n".
 */
export class GcloudLoggingEntryCountSettings extends GcloudLoggingReadSettings {
  /** Who this reader's error messages name. */
  protected override owner(): string {
    return "GcloudTasks.logEntryCount";
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
  if (settings.freshness_ === undefined && settings.since_ === undefined) {
    settings.freshness(DEFAULT_COUNT_FRESHNESS);
  }
  // Judge the caller's own limit before reading one past it, so a bad one is
  // refused in gcloud's terms rather than quietly made valid by the + 1.
  settings.limit(limit).argv();
  const command = gcloud(settings.limit(limit + 1)).format(COUNT_FORMAT)
    .quiet();
  const pinned = command.argv().filter((token) => PINNED.test(token));
  if (pinned.length !== 2) {
    throw new Error(
      `${task}: the count reader pins --limit and --format itself, and a ` +
        "--limit, --format or --flags-file set through .flag(...) or " +
        ".args(...) would override them — gcloud takes the last value. " +
        "Refused: use .limit(n), and leave --format to the reader.",
    );
  }
  const output = await command.run();
  failOnExit(command, output);
  const document = readJson(output, task);
  if (!Array.isArray(document)) {
    throw new GcloudOutputError(
      task,
      "gcloud did not print a list of entries. Leave --format to the " +
        "reader, which pins it.",
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
