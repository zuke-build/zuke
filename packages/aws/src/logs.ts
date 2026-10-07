// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws logs` commands — CloudWatch Logs Insights queries, filtering a log
 * group's events, and tailing it.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.logsFilterLogEvents((s) =>
 *   s.logGroupName("/ecs/api").filterPattern("ERROR").window("15m")
 * );
 * ```
 *
 * `AwsTasks.logsInsightsQuery` runs a whole Logs Insights query — start it,
 * poll for the results — and returns the rows; the two commands it is made of
 * are here for a build that wants them one at a time.
 *
 * @module
 */

import { freeText, operand, operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";
import { epochMilliseconds, epochSeconds, windowEnding } from "./time.ts";

/** Settings for `aws logs start-query`. */
export class AwsLogsStartQuerySettings extends AwsSettings {
  readonly #logGroupNames: string[] = [];
  #queryString?: string;
  #start?: Date;
  #end?: Date;
  #limit?: number;

  /** The log groups to query (`--log-group-names`); repeatable. */
  logGroupNames(...names: string[]): this {
    this.#logGroupNames.push(...names);
    return this;
  }

  /** The Logs Insights query (`--query-string`). */
  queryString(query: string): this {
    this.#queryString = freeText("logsStartQuery", "--query-string", query);
    return this;
  }

  /** The start of the range (`--start-time`, sent as epoch seconds). */
  startTime(time: Date): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`, sent as epoch seconds). */
  endTime(time: Date): this {
    this.#end = time;
    return this;
  }

  /** The `duration` up to `end` — now, unless given — as the time range. */
  window(duration: string | number, end: Date = new Date()): this {
    const range = windowEnding(duration, end);
    this.#start = range.start;
    this.#end = range.end;
    return this;
  }

  /** The most rows to return (`--limit`). */
  limit(rows: number): this {
    this.#limit = rows;
    return this;
  }

  /** Emit `logs start-query` with its options. */
  protected override leadingTokens(): string[] {
    if (
      this.#logGroupNames.length === 0 || this.#queryString === undefined ||
      this.#start === undefined || this.#end === undefined
    ) {
      throw new Error(
        "AwsTasks.logsStartQuery: a query needs log groups, a query string " +
          "and a time range — add .logGroupNames('/ecs/api')" +
          ".queryString('fields @message').window('15m').",
      );
    }
    const argv = [
      "logs",
      "start-query",
      "--log-group-names",
      ...operands("logsStartQuery", "--log-group-names", this.#logGroupNames),
      option("--start-time", epochSeconds(this.#start)),
      option("--end-time", epochSeconds(this.#end)),
      option("--query-string", this.#queryString),
    ];
    if (this.#limit !== undefined) argv.push(option("--limit", this.#limit));
    return argv;
  }
}

/** Settings for `aws logs get-query-results`. */
export class AwsLogsGetQueryResultsSettings extends AwsSettings {
  #queryId?: string;
  #nextToken?: string;

  /** The id `start-query` returned (`--query-id`). */
  queryId(id: string): this {
    this.#queryId = id;
    return this;
  }

  /** The page after the one that returned this token (`--next-token`). */
  nextToken(token: string): this {
    this.#nextToken = token;
    return this;
  }

  /** Emit `logs get-query-results` with the query id. */
  protected override leadingTokens(): string[] {
    if (this.#queryId === undefined) {
      throw new Error(
        "AwsTasks.logsGetQueryResults: no query named — add .queryId(id).",
      );
    }
    const argv = [
      "logs",
      "get-query-results",
      option("--query-id", this.#queryId),
    ];
    if (this.#nextToken !== undefined) {
      argv.push(option("--next-token", this.#nextToken));
    }
    return argv;
  }
}

/** Settings for `aws logs stop-query`. */
export class AwsLogsStopQuerySettings extends AwsSettings {
  #queryId?: string;

  /** The id `start-query` returned (`--query-id`). */
  queryId(id: string): this {
    this.#queryId = id;
    return this;
  }

  /** Emit `logs stop-query` with the query id. */
  protected override leadingTokens(): string[] {
    if (this.#queryId === undefined) {
      throw new Error(
        "AwsTasks.logsStopQuery: no query named — add .queryId(id).",
      );
    }
    return ["logs", "stop-query", option("--query-id", this.#queryId)];
  }
}

/** Settings for `aws logs filter-log-events`. */
export class AwsLogsFilterLogEventsSettings extends AwsSettings {
  #logGroupName?: string;
  readonly #logStreamNames: string[] = [];
  #logStreamNamePrefix?: string;
  #filterPattern?: string;
  #start?: Date;
  #end?: Date;

  /** The log group to search (`--log-group-name`). */
  logGroupName(name: string): this {
    this.#logGroupName = name;
    return this;
  }

  /** Only these streams (`--log-stream-names`); repeatable. */
  logStreamNames(...names: string[]): this {
    this.#logStreamNames.push(...names);
    return this;
  }

  /** Only streams whose name starts with this (`--log-stream-name-prefix`). */
  logStreamNamePrefix(prefix: string): this {
    this.#logStreamNamePrefix = prefix;
    return this;
  }

  /** A CloudWatch Logs filter pattern (`--filter-pattern`), e.g. `"ERROR"`. */
  filterPattern(pattern: string): this {
    this.#filterPattern = freeText(
      "logsFilterLogEvents",
      "--filter-pattern",
      pattern,
    );
    return this;
  }

  /** The start of the range (`--start-time`, sent as epoch milliseconds). */
  startTime(time: Date): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`, sent as epoch milliseconds). */
  endTime(time: Date): this {
    this.#end = time;
    return this;
  }

  /** The `duration` up to `end` — now, unless given — as the time range. */
  window(duration: string | number, end: Date = new Date()): this {
    const range = windowEnding(duration, end);
    this.#start = range.start;
    this.#end = range.end;
    return this;
  }

  /** Emit `logs filter-log-events` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#logGroupName === undefined) {
      throw new Error(
        "AwsTasks.logsFilterLogEvents: no log group named — add " +
          ".logGroupName('/ecs/api').",
      );
    }
    const argv = [
      "logs",
      "filter-log-events",
      option("--log-group-name", this.#logGroupName),
    ];
    if (this.#logStreamNames.length > 0) {
      argv.push(
        "--log-stream-names",
        ...operands(
          "logsFilterLogEvents",
          "--log-stream-names",
          this.#logStreamNames,
        ),
      );
    }
    if (this.#logStreamNamePrefix !== undefined) {
      argv.push(option("--log-stream-name-prefix", this.#logStreamNamePrefix));
    }
    if (this.#filterPattern !== undefined) {
      argv.push(option("--filter-pattern", this.#filterPattern));
    }
    if (this.#start !== undefined) {
      argv.push(option("--start-time", epochMilliseconds(this.#start)));
    }
    if (this.#end !== undefined) {
      argv.push(option("--end-time", epochMilliseconds(this.#end)));
    }
    return argv;
  }
}

/**
 * Settings for `aws logs tail`. With {@link follow} the command never ends on
 * its own — bound it with `.killAfter(ms)`.
 */
export class AwsLogsTailSettings extends AwsSettings {
  #groupName?: string;
  #since?: string;
  #follow = false;
  #filterPattern?: string;
  #format?: "detailed" | "short" | "json";
  readonly #logStreamNames: string[] = [];
  #logStreamNamePrefix?: string;

  /** The log group to tail (positional). */
  groupName(name: string): this {
    this.#groupName = name;
    return this;
  }

  /** How far back to start (`--since`), e.g. `"10m"` or an ISO timestamp. */
  since(value: string): this {
    this.#since = value;
    return this;
  }

  /** Keep printing new events as they arrive (`--follow`). */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** A CloudWatch Logs filter pattern (`--filter-pattern`). */
  filterPattern(pattern: string): this {
    this.#filterPattern = freeText("logsTail", "--filter-pattern", pattern);
    return this;
  }

  /** How each event is printed (`--format`). */
  format(value: "detailed" | "short" | "json"): this {
    this.#format = value;
    return this;
  }

  /** Only these streams (`--log-stream-names`); repeatable. */
  logStreamNames(...names: string[]): this {
    this.#logStreamNames.push(...names);
    return this;
  }

  /** Only streams whose name starts with this (`--log-stream-name-prefix`). */
  logStreamNamePrefix(prefix: string): this {
    this.#logStreamNamePrefix = prefix;
    return this;
  }

  /** Emit `logs tail` with the group and its options. */
  protected override leadingTokens(): string[] {
    if (this.#groupName === undefined) {
      throw new Error(
        "AwsTasks.logsTail: no log group named — add .groupName('/ecs/api').",
      );
    }
    const argv = [
      "logs",
      "tail",
      operand("logsTail", "group name", this.#groupName),
    ];
    if (this.#since !== undefined) argv.push(option("--since", this.#since));
    if (this.#follow) argv.push("--follow");
    if (this.#filterPattern !== undefined) {
      argv.push(option("--filter-pattern", this.#filterPattern));
    }
    if (this.#format !== undefined) argv.push(option("--format", this.#format));
    if (this.#logStreamNames.length > 0) {
      argv.push(
        "--log-stream-names",
        ...operands("logsTail", "--log-stream-names", this.#logStreamNames),
      );
    }
    if (this.#logStreamNamePrefix !== undefined) {
      argv.push(option("--log-stream-name-prefix", this.#logStreamNamePrefix));
    }
    return argv;
  }
}
