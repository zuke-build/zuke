// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link AzMonitorMetricValueSettings} — the settings behind
 * `AzTasks.metricValue`, which reads one number from Azure Monitor: the
 * latest datapoint of a metric, or an aggregate of its datapoints over the
 * range.
 *
 * @module
 */

import { AzOutputError } from "./errors.ts";
import {
  aggregationKey,
  checkSeriesLimit,
  type Datapoint,
  metricDataOf,
} from "./metric_data.ts";
import {
  type AzMonitorAggregation,
  AzMonitorMetricsListSettings,
} from "./monitor.ts";
import { finite } from "./validate.ts";

/** The task name in this reader's errors. */
const TASK = "AzTasks.metricValue";

/**
 * How {@link AzMonitorMetricValueSettings} turns the datapoints into one
 * number: the newest, or the sum, average, maximum or minimum of all of them.
 */
export type AzMonitorAggregate =
  | "latest"
  | "sum"
  | "average"
  | "maximum"
  | "minimum";

/**
 * Settings for `AzTasks.metricValue`: a `metrics list` request with exactly
 * one {@link AzMonitorMetricsListSettings.aggregation}, and how to read it.
 */
export class AzMonitorMetricValueSettings extends AzMonitorMetricsListSettings {
  /** The metric to read (set by {@link metric}); the only one when unset. */
  metric_?: string;
  /** How to turn the datapoints into one number (set by {@link aggregate}). */
  aggregate_: AzMonitorAggregate = "latest";
  /** The value to return when there are no datapoints (set by {@link missingDataAs}). */
  missingData_?: number;

  /** The task name used in this reader's error messages. */
  protected override taskName(): string {
    return "metricValue";
  }

  /**
   * The metric to read, by name. Needed only when the request names more
   * than one with `.metrics(...)`.
   */
  metric(name: string): this {
    this.metric_ = name;
    return this;
  }

  /**
   * How to turn the datapoints into one number, across every series the
   * answer holds. `"latest"` (the default) is the newest interval — the sum
   * of the series' values at the newest timestamp any of them has, so a
   * metric split by a dimension reads as its total. The others combine every
   * datapoint in the range: a `"sum"` of per-minute `Total`s is the range's
   * total.
   */
  aggregate(how: AzMonitorAggregate): this {
    this.aggregate_ = how;
    return this;
  }

  /**
   * Return `value` when there are no datapoints, instead of failing. Azure
   * Monitor reports an interval with no events without a value, so for a
   * count of errors no data does mean `0`; for a latency it usually means the
   * query is looking in the wrong place.
   */
  missingDataAs(value: number): this {
    this.missingData_ = finite(TASK, "missingDataAs", value);
    return this;
  }
}

/** Combine `datapoints` (newest first, at least one) as `how` says. */
function combine(
  how: AzMonitorAggregate,
  datapoints: Datapoint[],
): number {
  const values = datapoints.map((point) => point.value);
  switch (how) {
    case "latest": {
      const newest = datapoints[0].timestamp.getTime();
      return datapoints.filter((point) => point.timestamp.getTime() === newest)
        .reduce((total, point) => total + point.value, 0);
    }
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    // Folded rather than spread: a long series spread into Math.max is one
    // argument per datapoint, and enough of them overflow the call stack.
    case "maximum":
      return values.reduce((a, b) => (b > a ? b : a));
    case "minimum":
      return values.reduce((a, b) => (b < a ? b : a));
  }
}

/** The one aggregation the settings ask for, refused unless there is exactly one. */
function soleAggregation(
  aggregations: readonly AzMonitorAggregation[],
  task: string,
): AzMonitorAggregation {
  const [only] = aggregations;
  if (only === undefined || aggregations.length > 1) {
    throw new Error(
      `${task}: name exactly one aggregation to read — add ` +
        ".aggregation('Total'), or 'Average', 'Maximum', 'Minimum', 'Count'.",
    );
  }
  return only;
}

/** The one number `settings` ask for, from the parsed metrics list. */
export function metricValueOf(
  document: unknown,
  settings: AzMonitorMetricValueSettings,
): number {
  const key = aggregationKey(soleAggregation(settings.aggregations_, TASK));
  const { metric, series, datapoints } = metricDataOf(
    document,
    settings.metric_,
    key,
    TASK,
  );
  checkSeriesLimit(TASK, metric, series, settings.seriesLimit_);
  if (datapoints.length > 0) return combine(settings.aggregate_, datapoints);
  if (settings.missingData_ !== undefined) return settings.missingData_;
  throw new AzOutputError(
    TASK,
    `Azure Monitor returned no ${key} datapoints for "${metric}" in the ` +
      "time range. Check the resource, metric name and dimensions — or call " +
      ".missingDataAs(0) when no data means zero.",
  );
}
