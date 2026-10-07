// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading the datapoints out of a `monitor metrics list` answer. Internal to
 * the package: the `metricValue` reader and the `azureMonitor(...)` canary
 * analysis both read through it, so they agree on what an answer means.
 *
 * The answer's `value` is a list of metrics, each with a list of
 * `timeseries` (one per dimension combination), each with a `data` list of
 * one datapoint per interval. A datapoint carries a `timeStamp` and one key
 * per requested aggregation — `average`, `count`, `maximum`, `minimum`,
 * `total` — and an interval with no data carries none of them, so a missing
 * key is no data, not zero.
 *
 * @module
 */

import { AzOutputError } from "./errors.ts";
import type { AzMonitorAggregation } from "./monitor.ts";
import { isRecord } from "./shape.ts";

/** The `--query` the readers pin: the list of metrics. */
export const METRICS_QUERY = "value";

/** One datapoint of a series. */
export interface Datapoint {
  /** When the interval it aggregates began. */
  timestamp: Date;
  /** The value. */
  value: number;
}

/** What one metric's answer holds. */
interface MetricData {
  /** The metric's name, as Azure Monitor reported it. */
  metric: string;
  /** How many time series the answer holds. */
  series: number;
  /** Every datapoint with a value, newest first. */
  datapoints: Datapoint[];
}

/** The JSON key an aggregation's value is reported under. */
export function aggregationKey(aggregation: AzMonitorAggregation): string {
  return aggregation.toLowerCase();
}

/** The metric's name in an answer entry, if it has one. */
function nameOf(entry: unknown): string | undefined {
  if (!isRecord(entry) || !isRecord(entry.name)) return undefined;
  const { value } = entry.name;
  return typeof value === "string" ? value : undefined;
}

/** The datapoints of one time series's `data` list that carry `key`. */
function seriesPoints(
  data: unknown,
  key: string,
  metric: string,
  task: string,
): Datapoint[] {
  if (!Array.isArray(data)) {
    throw new AzOutputError(task, `a series of "${metric}" has no data list.`);
  }
  const points: Datapoint[] = [];
  for (const datum of data) {
    const timeStamp = isRecord(datum) ? datum.timeStamp : undefined;
    const timestamp = typeof timeStamp === "string"
      ? new Date(timeStamp)
      : undefined;
    if (
      !isRecord(datum) || timestamp === undefined ||
      Number.isNaN(timestamp.getTime())
    ) {
      throw new AzOutputError(
        task,
        `a datapoint of "${metric}" has no timeStamp that is a date.`,
      );
    }
    const value = datum[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") {
      throw new AzOutputError(
        task,
        `a datapoint of "${metric}" has a ${key} that is not a number.`,
      );
    }
    points.push({ timestamp, value });
  }
  return points;
}

/**
 * The `key` datapoints of `metric` in `document` (what {@link METRICS_QUERY}
 * projects), newest first, across every time series. With no `metric`, the
 * answer must hold exactly one. A metric Azure Monitor answered with an
 * `errorCode` other than `Success` is refused.
 */
export function metricDataOf(
  document: unknown,
  metric: string | undefined,
  key: string,
  task: string,
): MetricData {
  if (!Array.isArray(document)) {
    throw new AzOutputError(
      task,
      "the metrics list answer has no list of metrics.",
    );
  }
  const names = document.map(nameOf);
  const wanted = metric ??
    (names.length === 1 ? names[0] : undefined);
  if (wanted === undefined) {
    throw new AzOutputError(
      task,
      `the answer carries ${names.length} metrics, so say which one to read ` +
        "with .metric(...).",
    );
  }
  const entry = document.find((_candidate, index) =>
    names[index]?.toLowerCase() === wanted.toLowerCase()
  );
  if (!isRecord(entry)) {
    throw new AzOutputError(
      task,
      `the answer has no metric "${wanted}" — check the metric's name with ` +
        "monitorMetricsListDefinitions.",
    );
  }
  const { errorCode, timeseries } = entry;
  if (typeof errorCode === "string" && errorCode !== "Success") {
    throw new AzOutputError(
      task,
      `Azure Monitor answered metric "${wanted}" with error ${errorCode}.`,
    );
  }
  if (!Array.isArray(timeseries)) {
    throw new AzOutputError(task, `metric "${wanted}" has no timeseries list.`);
  }
  const datapoints = timeseries.flatMap((series) =>
    seriesPoints(isRecord(series) ? series.data : undefined, key, wanted, task)
  );
  datapoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return { metric: wanted, series: timeseries.length, datapoints };
}
