// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading the datapoints out of a `get-metric-data` response. Internal to the
 * package: the `metricValue` reader and the `cloudwatch(...)` canary analysis
 * both read through it, so they agree on what a response means.
 *
 * The CLI follows `NextToken` itself and concatenates the pages'
 * `MetricDataResults`, so one id can appear in several entries; their
 * datapoints are merged here.
 *
 * @module
 */

import { AwsOutputError } from "./errors.ts";
import { isNumberArray, isRecord, isStringArray } from "./shape.ts";

/** The `--query` the readers pin, so the CLI prints the results list alone. */
export const METRIC_DATA_RESULTS_QUERY = "MetricDataResults";

/** One datapoint of a series. */
export interface Datapoint {
  /** When the period it aggregates began. */
  timestamp: Date;
  /** The value. */
  value: number;
}

/** The status codes that mean CloudWatch did not answer the query. */
const FAILED_STATUS = ["InternalError", "Forbidden"];

/**
 * The ids the results carry, in order of first appearance. Used to pick the
 * one series when the caller named none.
 */
function idsOf(results: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of results) {
    if (isRecord(entry) && typeof entry.Id === "string") {
      if (!ids.includes(entry.Id)) ids.push(entry.Id);
    }
  }
  return ids;
}

/**
 * The datapoints of series `id` in `results` (the `MetricDataResults` list),
 * newest first. With no `id`, the results must hold exactly one series.
 */
export function datapointsOf(
  results: unknown,
  id: string | undefined,
  task: string,
): { id: string; datapoints: Datapoint[] } {
  if (!Array.isArray(results)) {
    throw new AwsOutputError(
      task,
      "the get-metric-data response has no MetricDataResults list.",
    );
  }
  const ids = idsOf(results);
  const wanted = id ?? (ids.length === 1 ? ids[0] : undefined);
  if (wanted === undefined) {
    throw new AwsOutputError(
      task,
      `the response carries ${ids.length} series (${ids.join(", ")}), so ` +
        "say which one to read with .id(...).",
    );
  }
  const datapoints: Datapoint[] = [];
  let seen = false;
  for (const entry of results) {
    if (!isRecord(entry) || entry.Id !== wanted) continue;
    seen = true;
    const { Timestamps, Values, StatusCode } = entry;
    if (typeof StatusCode === "string" && FAILED_STATUS.includes(StatusCode)) {
      throw new AwsOutputError(
        task,
        `CloudWatch answered series "${wanted}" with status ${StatusCode}.`,
      );
    }
    if (
      !isStringArray(Timestamps) || !isNumberArray(Values) ||
      Timestamps.length !== Values.length
    ) {
      throw new AwsOutputError(
        task,
        `series "${wanted}" does not pair each timestamp with a value.`,
      );
    }
    Timestamps.forEach((text, index) => {
      const timestamp = new Date(text);
      if (Number.isNaN(timestamp.getTime())) {
        throw new AwsOutputError(
          task,
          `series "${wanted}" has a timestamp that is not a date.`,
        );
      }
      datapoints.push({ timestamp, value: Values[index] });
    });
  }
  if (!seen) {
    throw new AwsOutputError(
      task,
      `the response has no series "${wanted}" — check the id names a query ` +
        "that returns data.",
    );
  }
  datapoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return { id: wanted, datapoints };
}
