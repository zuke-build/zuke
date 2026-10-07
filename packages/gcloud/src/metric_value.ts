// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link CloudMonitoringMetricValueSettings} — the settings behind
 * `CloudMonitoringTasks.metricValue`, which reads one number from Cloud
 * Monitoring: the latest aligned value of a metric, or an aggregate of its
 * points over the window.
 *
 * @module
 */

import type {
  CloudMonitoringTimeSeries,
  CloudMonitoringValue,
} from "./time_series.ts";
import { CloudMonitoringTimeSeriesSettings } from "./time_series_settings.ts";
import { finite } from "./validate.ts";

/** The task name in this reader's errors. */
const TASK = "CloudMonitoringTasks.metricValue";

/**
 * How {@link CloudMonitoringMetricValueSettings} turns the points into one
 * number: the newest, or the sum, average, maximum or minimum of all of them.
 */
export type CloudMonitoringAggregate =
  | "latest"
  | "sum"
  | "average"
  | "maximum"
  | "minimum";

/** One judged number and the time it is for. */
export interface NumericPoint {
  /** The end of the point's interval. */
  end: Date;
  /** The point's value as a number. */
  value: number;
}

/**
 * Settings for `CloudMonitoringTasks.metricValue`: a time-series read, and
 * how to turn it into one number. The view is always `FULL` — the reader
 * needs the points.
 */
export class CloudMonitoringMetricValueSettings
  extends CloudMonitoringTimeSeriesSettings {
  /** How to turn the points into one number (set by {@link aggregate}). */
  aggregate_: CloudMonitoringAggregate = "latest";
  /** The value to return when there are no points (set by {@link missingDataAs}). */
  missingData_?: number;

  /**
   * How to turn the points into one number, across every series the answer
   * holds. `"latest"` (the default) is the newest point — the sum of the
   * series' values at the newest end time any of them has, so a metric
   * split by a label reads as its total. The others combine every point in
   * the window: a `"sum"` of per-minute `ALIGN_SUM` points is the window's
   * total.
   */
  aggregate(how: CloudMonitoringAggregate): this {
    this.aggregate_ = how;
    return this;
  }

  /**
   * Return `value` when there are no points, instead of failing. Cloud
   * Monitoring writes no point for a period with no events, so for a count
   * of errors no data does mean `0`; for a latency it usually means the
   * filter is looking in the wrong place.
   */
  missingDataAs(value: number): this {
    this.missingData_ = finite(TASK, "missingDataAs", value);
    return this;
  }
}

/**
 * A point's value as a number: a double or an integer as it is, a
 * distribution as its mean. A boolean or a string has no number to judge,
 * and is refused with the aligner that turns it into one.
 */
export function numberOf(value: CloudMonitoringValue, task: string): number {
  switch (value.kind) {
    case "double":
    case "int64":
      return value.value;
    case "distribution":
      return value.mean;
    case "bool":
      throw new Error(
        `${task}: the metric is a BOOL, which has no number to judge — ` +
          'align it with .perSeriesAligner("ALIGN_FRACTION_TRUE") or ' +
          '"ALIGN_COUNT_TRUE".',
      );
    case "string":
      throw new Error(
        `${task}: the metric is a STRING, which has no number to judge.`,
      );
  }
}

/**
 * Every point of every series, as numbers — leaving out a distribution with
 * no samples, which is no data rather than a value of `0`.
 */
export function numericPoints(
  series: readonly CloudMonitoringTimeSeries[],
  task: string,
): NumericPoint[] {
  const points: NumericPoint[] = [];
  for (const one of series) {
    for (const point of one.points) {
      // A distribution with no samples has no mean to judge: its "0" is the
      // proto3 default, not a measurement, so it counts as no data.
      if (point.value.kind === "distribution" && point.value.count === 0) {
        continue;
      }
      points.push({ end: point.end, value: numberOf(point.value, task) });
    }
  }
  return points;
}

/** Combine `points` (at least one) as `how` says. */
function combine(
  how: CloudMonitoringAggregate,
  points: NumericPoint[],
): number {
  const values = points.map((point) => point.value);
  switch (how) {
    case "latest": {
      // Folded rather than spread: a long series spread into Math.max is one
      // argument per point, and enough of them overflow the call stack.
      const newest = points.reduce(
        (time, point) => Math.max(time, point.end.getTime()),
        Number.NEGATIVE_INFINITY,
      );
      return points.filter((point) => point.end.getTime() === newest)
        .reduce((total, point) => total + point.value, 0);
    }
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "maximum":
      return values.reduce((a, b) => (b > a ? b : a));
    case "minimum":
      return values.reduce((a, b) => (b < a ? b : a));
  }
}

/** The one number `settings` ask for, from the series read. */
export function metricValueOf(
  series: readonly CloudMonitoringTimeSeries[],
  settings: CloudMonitoringMetricValueSettings,
): number {
  const points = numericPoints(series, TASK);
  if (points.length === 0) {
    if (settings.missingData_ !== undefined) return settings.missingData_;
    throw new Error(
      `${TASK}: Cloud Monitoring returned no points in the window. Check the ` +
        "project, metric type, resource and labels — or call " +
        ".missingDataAs(0) when no data means zero.",
    );
  }
  const value = combine(settings.aggregate_, points);
  if (Number.isNaN(value)) {
    throw new Error(
      `${TASK}: the ${settings.aggregate_} of the points is not a number ` +
        "(NaN) — Cloud Monitoring sent a NaN point.",
    );
  }
  return value;
}
