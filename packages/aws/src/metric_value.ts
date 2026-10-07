// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link CloudwatchMetricValueSettings} — the settings behind
 * `AwsTasks.metricValue`, which reads one number from CloudWatch: the latest
 * datapoint of a series, or an aggregate of its datapoints over the window.
 *
 * @module
 */

import { CloudwatchGetMetricDataSettings } from "./cloudwatch.ts";
import { AwsOutputError } from "./errors.ts";
import { type Datapoint, datapointsOf } from "./metric_data.ts";

/**
 * How {@link CloudwatchMetricValueSettings} turns a series into one number:
 * its newest datapoint, or the sum, average, maximum or minimum of all of
 * them.
 */
export type CloudwatchAggregate =
  | "latest"
  | "sum"
  | "average"
  | "maximum"
  | "minimum";

/** Settings for `AwsTasks.metricValue`: a `get-metric-data` request, and how to read it. */
export class CloudwatchMetricValueSettings
  extends CloudwatchGetMetricDataSettings {
  /** The series to read (set by {@link id}); the only one when unset. */
  id_?: string;
  /** How to turn the series into one number (set by {@link aggregate}). */
  aggregate_: CloudwatchAggregate = "latest";
  /** The value to return when the series is empty (set by {@link missingDataAs}). */
  missingData_?: number;

  /** The task name used in this reader's error messages. */
  protected override taskName(): string {
    return "metricValue";
  }

  /**
   * The series to read, by query id. Needed only when the request returns
   * more than one — hide the inputs of an expression with
   * `.returnData(false)` and it is not.
   */
  id(queryId: string): this {
    this.id_ = queryId;
    return this;
  }

  /**
   * How to turn the series into one number (default `"latest"`, the newest
   * datapoint). An aggregate combines the datapoints the window holds: a
   * `"sum"` of per-minute `Sum`s is the window's total.
   */
  aggregate(how: CloudwatchAggregate): this {
    this.aggregate_ = how;
    return this;
  }

  /**
   * Return `value` when the series has no datapoints, instead of failing.
   * CloudWatch publishes nothing for a period with no events, so for a count
   * of errors, no data does mean `0`; for a latency or a CPU reading it
   * usually means the query is looking in the wrong place.
   */
  missingDataAs(value: number): this {
    this.missingData_ = value;
    return this;
  }
}

/** Combine `datapoints` (newest first, at least one) as `how` says. */
function combine(how: CloudwatchAggregate, datapoints: Datapoint[]): number {
  const values = datapoints.map((point) => point.value);
  switch (how) {
    case "latest":
      return values[0];
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "maximum":
      return Math.max(...values);
    case "minimum":
      return Math.min(...values);
  }
}

/** The one number `settings` ask for, from the parsed `MetricDataResults`. */
export function metricValueOf(
  results: unknown,
  settings: CloudwatchMetricValueSettings,
): number {
  const task = "AwsTasks.metricValue";
  const { id, datapoints } = datapointsOf(results, settings.id_, task);
  if (datapoints.length > 0) return combine(settings.aggregate_, datapoints);
  if (settings.missingData_ !== undefined) return settings.missingData_;
  throw new AwsOutputError(
    task,
    `CloudWatch returned no datapoints for "${id}" in the time range. ` +
      "Check the namespace, metric name, dimensions and region — or call " +
      ".missingDataAs(0) when no data means zero.",
  );
}
