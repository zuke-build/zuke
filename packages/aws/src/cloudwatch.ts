// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws cloudwatch` commands — reading metrics and alarm states.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * const errors = await AwsTasks.metricValue((s) =>
 *   s.metricStat("errors", (m) =>
 *     m.namespace("AWS/ApplicationELB").metricName("HTTPCode_Target_5XX_Count")
 *       .dimension("LoadBalancer", "app/web/1f2e").stat("Sum")
 *   ).window("15m").aggregate("sum").missingDataAs(0)
 * );
 * const state = await AwsTasks.alarmState("api-5xx");
 * ```
 *
 * The metric queries are typed (see `metric_query.ts`) and rendered to the
 * `--metric-data-queries` JSON document by the API's own field names.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  AwsCloudwatchExpressionSettings,
  AwsCloudwatchMetricStatSettings,
  type AwsCloudwatchStatistic,
  expressionQuery,
  type MetricDataQuery,
  metricStatQuery,
} from "./metric_query.ts";
import { operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";
import { windowEnding } from "./time.ts";

/** The states a CloudWatch alarm can be in. */
export type AwsCloudwatchAlarmState = "OK" | "ALARM" | "INSUFFICIENT_DATA";

/** The kinds of alarm `describe-alarms` can return. */
export type AwsCloudwatchAlarmType =
  | "MetricAlarm"
  | "CompositeAlarm"
  | "LogAlarm";

/** A time given as a `Date` or as a string the CLI parses (ISO 8601). */
export type AwsTime = Date | string;

/** A time as the CLI takes it. */
function iso(time: AwsTime): string {
  return typeof time === "string" ? time : time.toISOString();
}

/** Settings for `aws cloudwatch get-metric-data`. */
export class AwsCloudwatchGetMetricDataSettings extends AwsSettings {
  readonly #queries: Array<(task: string) => MetricDataQuery> = [];
  #start?: AwsTime;
  #end?: AwsTime;
  #scanBy?: "TimestampDescending" | "TimestampAscending";
  #maxDatapoints?: number;

  /** The task name used in this command's error messages. */
  protected taskName(): string {
    return "cloudwatchGetMetricData";
  }

  /** Add a metric to the request, under `id`, configured by `configure`. */
  metricStat(
    id: string,
    configure: Configure<AwsCloudwatchMetricStatSettings>,
  ): this {
    this.#queries.push((task) =>
      metricStatQuery(
        task,
        id,
        configure(new AwsCloudwatchMetricStatSettings()),
      )
    );
    return this;
  }

  /**
   * Add a metric-math expression over the request's other ids, e.g.
   * `("ratio", "100 * errors / requests")`.
   */
  expression(
    id: string,
    expression: string,
    configure: Configure<AwsCloudwatchExpressionSettings> = (e) => e,
  ): this {
    this.#queries.push((task) =>
      expressionQuery(
        task,
        id,
        expression,
        configure(new AwsCloudwatchExpressionSettings()),
      )
    );
    return this;
  }

  /** The start of the range (`--start-time`). */
  startTime(time: AwsTime): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`). */
  endTime(time: AwsTime): this {
    this.#end = time;
    return this;
  }

  /**
   * The `duration` (`"15m"`, or milliseconds) up to `end` — now, unless
   * given — as `--start-time` and `--end-time`.
   */
  window(duration: string | number, end: Date = new Date()): this {
    const range = windowEnding(duration, end);
    this.#start = range.start;
    this.#end = range.end;
    return this;
  }

  /** The order of the datapoints (`--scan-by`); newest first by default. */
  scanBy(order: "TimestampDescending" | "TimestampAscending"): this {
    this.#scanBy = order;
    return this;
  }

  /**
   * Whether this request must read every page. A reader that turns the
   * datapoints into one value does: a value computed from part of a window
   * looks just like a value computed from all of it. Overridden by the
   * settings behind `AwsTasks.metricValue`.
   */
  protected readsEveryPage(): boolean {
    return false;
  }

  /**
   * The most datapoints to return (`--max-datapoints`). Setting it turns off
   * the CLI's automatic pagination — the CLI treats it as a page size and
   * returns one page with a `NextToken` — so the answer may hold only part
   * of the window. `AwsTasks.metricValue` refuses it for that reason.
   */
  maxDatapoints(count: number): this {
    this.#maxDatapoints = count;
    return this;
  }

  /** Emit `cloudwatch get-metric-data` with its options. */
  protected override leadingTokens(): string[] {
    const task = this.taskName();
    if (this.#queries.length === 0) {
      throw new Error(
        `AwsTasks.${task}: no metric to read — add .metricStat(id, (m) => …).`,
      );
    }
    if (this.#start === undefined || this.#end === undefined) {
      throw new Error(
        `AwsTasks.${task}: no time range — add .window('15m'), or ` +
          ".startTime(...) and .endTime(...).",
      );
    }
    if (this.#maxDatapoints !== undefined && this.readsEveryPage()) {
      throw new Error(
        `AwsTasks.${task}: .maxDatapoints(...) turns off the CLI's ` +
          "pagination, so the value would be read from one page of the " +
          "window. Leave it out.",
      );
    }
    const queries = this.#queries.map((query) => query(task));
    const ids = queries.map((query) => query.Id);
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    if (repeated !== undefined) {
      throw new Error(
        `AwsTasks.${task}: the id "${repeated}" is used twice — each query ` +
          "needs its own.",
      );
    }
    const argv = [
      "cloudwatch",
      "get-metric-data",
      "--metric-data-queries",
      JSON.stringify(queries),
      option("--start-time", iso(this.#start)),
      option("--end-time", iso(this.#end)),
    ];
    if (this.#scanBy !== undefined) {
      argv.push(option("--scan-by", this.#scanBy));
    }
    if (this.#maxDatapoints !== undefined) {
      argv.push(option("--max-datapoints", this.#maxDatapoints));
    }
    return argv;
  }
}

/** Settings for `aws cloudwatch get-metric-statistics`. */
export class AwsCloudwatchGetMetricStatisticsSettings extends AwsSettings {
  #namespace?: string;
  #metricName?: string;
  readonly #dimensions: Array<{ Name: string; Value: string }> = [];
  #start?: AwsTime;
  #end?: AwsTime;
  #period?: number;
  readonly #statistics: AwsCloudwatchStatistic[] = [];
  readonly #extendedStatistics: string[] = [];
  #unit?: string;

  /** The metric's namespace (`--namespace`). */
  namespace(value: string): this {
    this.#namespace = value;
    return this;
  }

  /** The metric's name (`--metric-name`). */
  metricName(value: string): this {
    this.#metricName = value;
    return this;
  }

  /** A dimension that picks the series (`--dimensions`); repeatable. */
  dimension(name: string, value: string): this {
    this.#dimensions.push({ Name: name, Value: value });
    return this;
  }

  /** The start of the range (`--start-time`). */
  startTime(time: AwsTime): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`). */
  endTime(time: AwsTime): this {
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

  /** The aggregation period in seconds (`--period`). */
  period(seconds: number): this {
    this.#period = seconds;
    return this;
  }

  /** The basic statistics to return (`--statistics`), e.g. `"Sum"`. */
  statistics(
    ...values: Array<"SampleCount" | "Average" | "Sum" | "Minimum" | "Maximum">
  ): this {
    this.#statistics.push(...values);
    return this;
  }

  /** Percentiles and other extended statistics (`--extended-statistics`), e.g. `"p99"`. */
  extendedStatistics(...values: string[]): this {
    this.#extendedStatistics.push(...values);
    return this;
  }

  /** Only datapoints published in this unit (`--unit`). */
  unit(value: string): this {
    this.#unit = value;
    return this;
  }

  /** Emit `cloudwatch get-metric-statistics` with its options. */
  protected override leadingTokens(): string[] {
    if (
      this.#namespace === undefined || this.#metricName === undefined ||
      this.#start === undefined || this.#end === undefined ||
      this.#period === undefined
    ) {
      throw new Error(
        "AwsTasks.cloudwatchGetMetricStatistics: name the metric, the time " +
          "range and the period — add .namespace(ns).metricName(name)" +
          ".window('1h').period(300).",
      );
    }
    if (
      this.#statistics.length === 0 && this.#extendedStatistics.length === 0
    ) {
      throw new Error(
        "AwsTasks.cloudwatchGetMetricStatistics: no statistic asked for — add " +
          ".statistics('Sum') or .extendedStatistics('p99').",
      );
    }
    const argv = [
      "cloudwatch",
      "get-metric-statistics",
      option("--namespace", this.#namespace),
      option("--metric-name", this.#metricName),
    ];
    if (this.#dimensions.length > 0) {
      argv.push("--dimensions", JSON.stringify(this.#dimensions));
    }
    argv.push(
      option("--start-time", iso(this.#start)),
      option("--end-time", iso(this.#end)),
      option("--period", this.#period),
    );
    if (this.#statistics.length > 0) {
      argv.push("--statistics", ...this.#statistics);
    }
    if (this.#extendedStatistics.length > 0) {
      argv.push(
        "--extended-statistics",
        ...operands(
          "cloudwatchGetMetricStatistics",
          "--extended-statistics",
          this.#extendedStatistics,
        ),
      );
    }
    if (this.#unit !== undefined) argv.push(option("--unit", this.#unit));
    return argv;
  }
}

/** Settings for `aws cloudwatch describe-alarms`. */
export class AwsCloudwatchDescribeAlarmsSettings extends AwsSettings {
  readonly #alarmNames: string[] = [];
  #alarmNamePrefix?: string;
  #stateValue?: AwsCloudwatchAlarmState;
  #alarmTypes: AwsCloudwatchAlarmType[] = [];

  /** Only these alarms (`--alarm-names`); repeatable. */
  alarmNames(...names: string[]): this {
    this.#alarmNames.push(...names);
    return this;
  }

  /** Only alarms whose name starts with this (`--alarm-name-prefix`). */
  alarmNamePrefix(prefix: string): this {
    this.#alarmNamePrefix = prefix;
    return this;
  }

  /** Only alarms in this state (`--state-value`). */
  stateValue(state: AwsCloudwatchAlarmState): this {
    this.#stateValue = state;
    return this;
  }

  /**
   * The kinds of alarm to return (`--alarm-types`): metric, composite or log
   * alarms; replaces any set before. Without it the CLI returns metric
   * alarms only.
   */
  alarmTypes(...types: AwsCloudwatchAlarmType[]): this {
    this.#alarmTypes = [...types];
    return this;
  }

  /** Emit `cloudwatch describe-alarms` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["cloudwatch", "describe-alarms"];
    if (this.#alarmNames.length > 0) {
      argv.push(
        "--alarm-names",
        ...operands(
          "cloudwatchDescribeAlarms",
          "--alarm-names",
          this.#alarmNames,
        ),
      );
    }
    if (this.#alarmNamePrefix !== undefined) {
      argv.push(option("--alarm-name-prefix", this.#alarmNamePrefix));
    }
    if (this.#stateValue !== undefined) {
      argv.push(option("--state-value", this.#stateValue));
    }
    if (this.#alarmTypes.length > 0) {
      argv.push("--alarm-types", ...this.#alarmTypes);
    }
    return argv;
  }
}
