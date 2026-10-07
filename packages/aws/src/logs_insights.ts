// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link LogsInsightsQuerySettings} — the settings behind
 * `AwsTasks.logsInsightsQuery`, which runs a CloudWatch Logs Insights query
 * to the end: `logs start-query`, then `logs get-query-results` until the
 * query is `Complete`, returning its rows.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * const rows = await AwsTasks.logsInsightsQuery((q) =>
 *   q.logGroupNames("/ecs/api").window("30m")
 *     .queryString("stats count(*) as errors by bin(5m) | filter @message like /ERROR/")
 *     .aws((a) => a.region("eu-west-1"))
 * );
 * ```
 *
 * The query spans several commands, so the global options — profile, region,
 * a runner — go in `.aws(...)`, which is applied to every one of them.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { AwsLogsQueryError, AwsOutputError } from "./errors.ts";
import {
  LogsGetQueryResultsSettings,
  LogsStartQuerySettings,
  LogsStopQuerySettings,
} from "./logs.ts";
import { readJson } from "./scalar_output.ts";
import type { AwsSettings } from "./settings.ts";
import { isRecord } from "./shape.ts";
import { windowEnding } from "./time.ts";

/** One row of a Logs Insights result: each field the query returned, by name. */
export type LogsInsightsRow = Record<string, string>;

/** The task name in this reader's errors. */
const TASK = "AwsTasks.logsInsightsQuery";

/** How long to wait for a query when no timeout is set. */
const DEFAULT_TIMEOUT = 5 * 60_000;

/** How long to wait between polls when no interval is set. */
const DEFAULT_POLL_INTERVAL = 1_000;

/** The statuses of a query that has not finished yet. */
const PENDING = ["Scheduled", "Running"];

/** Settings for `AwsTasks.logsInsightsQuery`: the query, and how long to wait for it. */
export class LogsInsightsQuerySettings {
  /** The log groups to query (set by {@link logGroupNames}). */
  readonly logGroupNames_: string[] = [];
  /** The Logs Insights query (set by {@link queryString}). */
  queryString_?: string;
  /** The start of the range (set by {@link startTime} or {@link window}). */
  start_?: Date;
  /** The end of the range (set by {@link endTime} or {@link window}). */
  end_?: Date;
  /** The most rows to return (set by {@link limit}). */
  limit_?: number;
  /** How long to wait for the query, in ms (set by {@link timeout}). */
  timeout_: number = DEFAULT_TIMEOUT;
  /** The pause between polls, in ms (set by {@link pollInterval}). */
  pollInterval_: number = DEFAULT_POLL_INTERVAL;
  /** Global options for every command (set by {@link aws}). */
  aws_: Configure<AwsSettings> = (a) => a;

  /** The log groups to query (`--log-group-names`); repeatable. */
  logGroupNames(...names: string[]): this {
    this.logGroupNames_.push(...names);
    return this;
  }

  /** The Logs Insights query (`--query-string`). */
  queryString(query: string): this {
    this.queryString_ = query;
    return this;
  }

  /** The start of the range. */
  startTime(time: Date): this {
    this.start_ = time;
    return this;
  }

  /** The end of the range. */
  endTime(time: Date): this {
    this.end_ = time;
    return this;
  }

  /** The `duration` up to `end` — now, unless given — as the time range. */
  window(duration: string | number, end: Date = new Date()): this {
    const range = windowEnding(duration, end);
    this.start_ = range.start;
    this.end_ = range.end;
    return this;
  }

  /** The most rows to return (`--limit`). */
  limit(rows: number): this {
    this.limit_ = rows;
    return this;
  }

  /**
   * How long to wait for the query to finish (`"2m"`, or ms; default 5
   * minutes). A query still running then is stopped, and the reader fails.
   */
  timeout(duration: string | number): this {
    this.timeout_ = parseDuration(duration);
    return this;
  }

  /** The pause between polls for the results (`"2s"`, or ms; default 1 second). */
  pollInterval(duration: string | number): this {
    this.pollInterval_ = parseDuration(duration);
    return this;
  }

  /**
   * Global options for every command the query runs —
   * `(a) => a.profile("prod").region("eu-west-1")`, a `.toolPath(...)`, or a
   * `.runner(...)`.
   */
  aws(configure: Configure<AwsSettings>): this {
    this.aws_ = configure;
    return this;
  }
}

/** Configure `settings` as the query's command: global options, quiet, JSON. */
function prepared<S extends AwsSettings>(
  settings: S,
  query: LogsInsightsQuerySettings,
): S {
  query.aws_(settings);
  return settings.quiet().output("json");
}

/** Wait `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start the query and return its id. */
async function start(query: LogsInsightsQuerySettings): Promise<string> {
  const settings = new LogsStartQuerySettings()
    .logGroupNames(...query.logGroupNames_);
  if (query.queryString_ !== undefined) {
    settings.queryString(query.queryString_);
  }
  if (query.start_ !== undefined) settings.startTime(query.start_);
  if (query.end_ !== undefined) settings.endTime(query.end_);
  if (query.limit_ !== undefined) settings.limit(query.limit_);
  const answer = readJson(await prepared(settings, query).run(), TASK);
  if (!isRecord(answer) || typeof answer.queryId !== "string") {
    throw new AwsOutputError(TASK, "start-query returned no queryId.");
  }
  return answer.queryId;
}

/** The rows of a `Complete` answer, each field by name. */
function rowsOf(results: unknown): LogsInsightsRow[] {
  if (!Array.isArray(results)) {
    throw new AwsOutputError(
      TASK,
      "get-query-results returned no results list.",
    );
  }
  return results.map((fields) => {
    if (!Array.isArray(fields)) {
      throw new AwsOutputError(TASK, "a result row is not a list of fields.");
    }
    const row: LogsInsightsRow = {};
    for (const cell of fields) {
      if (
        !isRecord(cell) || typeof cell.field !== "string" ||
        typeof cell.value !== "string"
      ) {
        throw new AwsOutputError(
          TASK,
          "a result field is not a { field, value } pair of strings.",
        );
      }
      row[cell.field] = cell.value;
    }
    return row;
  });
}

/** Stop a query the reader has given up on; a failure to stop is not reported. */
async function stop(query: LogsInsightsQuerySettings, id: string) {
  try {
    await prepared(new LogsStopQuerySettings().queryId(id), query).noThrow()
      .run();
  } catch {
    // Best effort: the query ends on its own when the service's limit runs
    // out, and the timeout below is the error worth reporting.
  }
}

/** Run the query `query` describes to the end and return its rows. */
export async function runLogsInsightsQuery(
  query: LogsInsightsQuerySettings,
): Promise<LogsInsightsRow[]> {
  const id = await start(query);
  const deadline = Date.now() + query.timeout_;
  for (;;) {
    const settings = prepared(
      new LogsGetQueryResultsSettings().queryId(id),
      query,
    );
    const answer = readJson(await settings.run(), TASK);
    if (!isRecord(answer) || typeof answer.status !== "string") {
      throw new AwsOutputError(TASK, "get-query-results returned no status.");
    }
    const { status } = answer;
    if (status === "Complete") return rowsOf(answer.results);
    if (!PENDING.includes(status)) {
      throw new AwsLogsQueryError(
        id,
        status,
        `${TASK}: the query ended with status ${status}, not Complete.`,
      );
    }
    if (Date.now() >= deadline) {
      await stop(query, id);
      throw new AwsLogsQueryError(
        id,
        status,
        `${TASK}: the query was still ${status} after ` +
          `${query.timeout_} ms, so it was stopped. Narrow the time range ` +
          "or the log groups, or raise .timeout(...).",
      );
    }
    await sleep(query.pollInterval_);
  }
}
