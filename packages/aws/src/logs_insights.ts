// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link AwsLogsInsightsQuerySettings} — the settings behind
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
  AwsLogsGetQueryResultsSettings,
  AwsLogsStartQuerySettings,
  AwsLogsStopQuerySettings,
} from "./logs.ts";
import { jsonFrom, WHOLE_ANSWER } from "./reader.ts";
import type { AwsSettings } from "./settings.ts";
import { isRecord } from "./shape.ts";
import { windowEnding } from "./time.ts";

/** One row of a Logs Insights result: each field the query returned, by name. */
export type AwsLogsInsightsRow = Record<string, string>;

/** The task name in this reader's errors. */
const TASK = "AwsTasks.logsInsightsQuery";

/** How long to wait for a query when no timeout is set. */
const DEFAULT_TIMEOUT = 5 * 60_000;

/** How long to wait between polls when no interval is set. */
const DEFAULT_POLL_INTERVAL = 1_000;

/** The statuses of a query that has not finished yet. */
const PENDING = ["Scheduled", "Running"];

/** Settings for `AwsTasks.logsInsightsQuery`: the query, and how long to wait for it. */
export class AwsLogsInsightsQuerySettings {
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
  /** Cancels the wait and stops the query (set by {@link signal}). */
  signal_?: AbortSignal;

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

  /**
   * Cancel the query with `signal`: the poll stops at once, the query is
   * stopped, and the reader fails with the signal's reason. Pass a target's
   * `ctx.signal` here — core's own run signal reaches each `aws` command
   * already, but not the pause between two polls.
   */
  signal(signal: AbortSignal): this {
    this.signal_ = signal;
    return this;
  }
}

/** `settings` with the query's global options applied. */
function prepared<S extends AwsSettings>(
  settings: S,
  query: AwsLogsInsightsQuerySettings,
): S {
  query.aws_(settings);
  return settings;
}

/** Wait `ms` milliseconds, or until `signal` aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** Start the query and return its id. */
async function start(query: AwsLogsInsightsQuerySettings): Promise<string> {
  const settings = new AwsLogsStartQuerySettings()
    .logGroupNames(...query.logGroupNames_);
  if (query.queryString_ !== undefined) {
    settings.queryString(query.queryString_);
  }
  if (query.start_ !== undefined) settings.startTime(query.start_);
  if (query.end_ !== undefined) settings.endTime(query.end_);
  if (query.limit_ !== undefined) settings.limit(query.limit_);
  const answer = await jsonFrom(prepared(settings, query), TASK, WHOLE_ANSWER);
  if (!isRecord(answer) || typeof answer.queryId !== "string") {
    throw new AwsOutputError(TASK, "start-query returned no queryId.");
  }
  return answer.queryId;
}

/** The rows of one `Complete` page, each field by name. */
function rowsOf(results: unknown): AwsLogsInsightsRow[] {
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
    const row: AwsLogsInsightsRow = {};
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

/** One `get-query-results` answer. */
interface Page {
  /** `Scheduled`, `Running`, `Complete`, `Failed`, … */
  status: string;
  /** The rows, once the query is `Complete`. */
  results: unknown;
  /** The token for the next page of rows, when there is one. */
  nextToken: unknown;
}

/** One `get-query-results` answer, bounded by the time the reader has left. */
async function poll(
  query: AwsLogsInsightsQuerySettings,
  id: string,
  deadline: number,
  nextToken?: string,
): Promise<Page> {
  const settings = prepared(
    new AwsLogsGetQueryResultsSettings().queryId(id),
    query,
  ).killAfter(Math.max(1, deadline - Date.now()));
  if (nextToken !== undefined) settings.nextToken(nextToken);
  const answer = await jsonFrom(settings, TASK, WHOLE_ANSWER);
  if (!isRecord(answer) || typeof answer.status !== "string") {
    throw new AwsOutputError(TASK, "get-query-results returned no status.");
  }
  const { status, results, nextToken: next } = answer;
  return { status, results, nextToken: next };
}

/** Stop a query the reader has given up on; a failure to stop is not reported. */
async function stop(query: AwsLogsInsightsQuerySettings, id: string) {
  try {
    const settings = prepared(
      new AwsLogsStopQuerySettings().queryId(id),
      query,
    );
    await settings.quiet().output("json").query(WHOLE_ANSWER).noThrow().run();
  } catch {
    // Best effort: the query ends on its own when the service's limit runs
    // out, and the error that got us here is the one worth reporting.
  }
}

/**
 * The rows of a `Complete` query: `answer`'s, then every page after it the
 * service hands a `nextToken` for.
 */
async function allRows(
  query: AwsLogsInsightsQuerySettings,
  id: string,
  deadline: number,
  answer: Page,
): Promise<AwsLogsInsightsRow[]> {
  const rows = rowsOf(answer.results);
  let token = answer.nextToken;
  while (typeof token === "string") {
    const page = await poll(query, id, deadline, token);
    rows.push(...rowsOf(page.results));
    token = page.nextToken;
  }
  return rows;
}

/**
 * Poll until the query is `Complete` and return its rows — or throw when it
 * ends otherwise, outlasts the timeout, or is cancelled.
 */
async function untilComplete(
  query: AwsLogsInsightsQuerySettings,
  id: string,
): Promise<AwsLogsInsightsRow[]> {
  const deadline = Date.now() + query.timeout_;
  for (;;) {
    query.signal_?.throwIfAborted();
    const answer = await poll(query, id, deadline);
    const { status } = answer;
    if (status === "Complete") {
      return await allRows(query, id, deadline, answer);
    }
    if (!PENDING.includes(status)) {
      throw new AwsLogsQueryError(
        id,
        status,
        `${TASK}: the query ended with status ${status}, not Complete.`,
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AwsLogsQueryError(
        id,
        status,
        `${TASK}: the query was still ${status} after ` +
          `${query.timeout_} ms, so it was stopped. Narrow the time range ` +
          "or the log groups, or raise .timeout(...).",
      );
    }
    await sleep(Math.min(query.pollInterval_, remaining), query.signal_);
  }
}

/**
 * Run the query `query` describes to the end and return its rows. Whatever
 * ends the wait early — the timeout, a cancellation, a failed command, an
 * answer of the wrong shape — the query is stopped before the error is
 * raised, so it does not run on in the account.
 */
export async function runLogsInsightsQuery(
  query: AwsLogsInsightsQuerySettings,
): Promise<AwsLogsInsightsRow[]> {
  const id = await start(query);
  try {
    return await untilComplete(query, id);
  } catch (error) {
    // A query that ended on its own has nothing to stop.
    const ended = error instanceof AwsLogsQueryError &&
      !PENDING.includes(error.status);
    if (!ended) await stop(query, id);
    throw error;
  }
}
