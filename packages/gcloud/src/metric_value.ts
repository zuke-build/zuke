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
import {
  type CloudMonitoringAligner,
  CloudMonitoringTimeSeriesSettings,
} from "./time_series_settings.ts";
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

/** One point as a number, the time it is for, and its weight. */
interface NumericPoint {
  /** The end of the point's interval. */
  end: Date;
  /** The point's value as a number — a distribution's mean. */
  value: number;
  /** How many samples the value stands for: a distribution's count, else 1. */
  weight: number;
}

/** One series' points as numbers, and whether they are distribution means. */
interface NumericSeries {
  /** Whether the points are the means of distributions. */
  distribution: boolean;
  /** The points, as the API listed them. */
  points: NumericPoint[];
}

/** The aligners that turn a running total into increases or a rate. */
const DELTA_ALIGNERS: readonly CloudMonitoringAligner[] = [
  "ALIGN_DELTA",
  "ALIGN_RATE",
];

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
   * holds. `"latest"` (the default) sums each series' own newest point, so a
   * metric split by a label reads as its total. The others combine every
   * point in the window: a `"sum"` of per-minute `ALIGN_SUM` points is the
   * window's total.
   *
   * A `DISTRIBUTION` point reads as its mean. `"average"` weights each mean
   * by its sample count; `"maximum"` and `"minimum"` are of the means.
   * Means cannot be added, so `"sum"` refuses distributions, and `"latest"`
   * refuses more than one distribution series — collapse them with
   * `.crossSeriesReducer(...)`, or align them to a number with
   * `ALIGN_PERCENTILE_99`, `ALIGN_MEAN` and the like.
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
 * A scalar point's value as a number: a double or an integer as it is. A
 * boolean or a string has no number to judge, and is refused with the
 * aligner that turns it into one.
 */
function numberOf(
  value: Exclude<CloudMonitoringValue, { kind: "distribution" }>,
  task: string,
): number {
  switch (value.kind) {
    case "double":
    case "int64":
      return value.value;
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
 * Every series as numbers — leaving out a distribution with no samples,
 * which is no data rather than a value of `0`. A `CUMULATIVE` series is
 * refused unless `aligner` turns it into increases or a rate: its points
 * are running totals, so a sum counts the same events again and again and a
 * bound judges the total since the series began.
 */
export function numericSeries(
  series: readonly CloudMonitoringTimeSeries[],
  aligner: CloudMonitoringAligner | undefined,
  task: string,
): NumericSeries[] {
  const delta = aligner !== undefined && DELTA_ALIGNERS.includes(aligner);
  return series.map((one) => {
    if (one.metricKind === "CUMULATIVE" && !delta) {
      throw new Error(
        `${task}: the metric is CUMULATIVE — each point is a running total — ` +
          'so it cannot be judged as it is. Add .alignmentPeriod("60s") with ' +
          '.perSeriesAligner("ALIGN_DELTA") for the increase per period, or ' +
          '"ALIGN_RATE" for a rate.',
      );
    }
    const points: NumericPoint[] = [];
    for (const point of one.points) {
      const value = point.value;
      if (value.kind === "distribution") {
        if (value.count === 0) continue;
        points.push({
          end: point.end,
          value: value.mean,
          weight: value.count,
        });
      } else {
        points.push({
          end: point.end,
          value: numberOf(value, task),
          weight: 1,
        });
      }
    }
    return {
      distribution: one.points.some((p) => p.value.kind === "distribution"),
      points,
    };
  });
}

/** The sum of `values`, folded. */
function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

/** Each series' own newest point, from the series that have one. */
function newestOfEach(series: readonly NumericSeries[]): NumericPoint[] {
  return series.flatMap((one) =>
    one.points.length === 0 ? [] : [
      one.points.reduce((a, b) => (b.end.getTime() > a.end.getTime() ? b : a)),
    ]
  );
}

/** Refuse adding distribution means together, naming what to do instead. */
function meansCannotAdd(task: string, how: string): Error {
  return new Error(
    `${task}: the metric is a DISTRIBUTION, read as each point's mean, and ` +
      `means cannot be added, so "${how}" has no meaning here. Collapse the ` +
      "series with .crossSeriesReducer(...), align them to one number with " +
      '.perSeriesAligner("ALIGN_PERCENTILE_99") or "ALIGN_MEAN", or use ' +
      '"average", "maximum" or "minimum".',
  );
}

/** Combine the points of `series` (at least one point in all) as `how` says. */
function combine(
  how: CloudMonitoringAggregate,
  series: readonly NumericSeries[],
  task: string,
): number {
  const points = series.flatMap((one) => one.points);
  const distribution = series.some((one) => one.distribution);
  // Folded rather than spread: a long series spread into Math.max is one
  // argument per point, and enough of them overflow the call stack.
  const values = points.map((point) => point.value);
  switch (how) {
    case "latest": {
      const newest = newestOfEach(series);
      if (distribution && newest.length > 1) throw meansCannotAdd(task, how);
      return total(newest.map((point) => point.value));
    }
    case "sum":
      if (distribution) throw meansCannotAdd(task, how);
      return total(values);
    case "average":
      // Each point weighs what it stands for: one sample, or a
      // distribution's count — so a mean of means is not skewed by a
      // period with a single slow request.
      return total(points.map((point) => point.value * point.weight)) /
        total(points.map((point) => point.weight));
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
  const numeric = numericSeries(series, settings.perSeriesAligner_, TASK);
  const points = numeric.flatMap((one) => one.points);
  if (points.length === 0) {
    if (settings.missingData_ !== undefined) return settings.missingData_;
    throw new Error(
      `${TASK}: Cloud Monitoring returned no points in the window. Check the ` +
        "project, metric type, resource and labels — or call " +
        ".missingDataAs(0) when no data means zero.",
    );
  }
  // Refused before combining: a NaN compares false both ways, so a maximum
  // or minimum would skip it unless it came first.
  if (points.some((point) => Number.isNaN(point.value))) {
    throw new Error(
      `${TASK}: Cloud Monitoring sent a point that is not a number (NaN), ` +
        "so no aggregate of the points is one either.",
    );
  }
  return combine(settings.aggregate_, numeric, TASK);
}
