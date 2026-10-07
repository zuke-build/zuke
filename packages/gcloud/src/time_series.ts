// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The time series `CloudMonitoringTasks.timeSeriesList` returns, and the
 * parsing of one page of the Cloud Monitoring API's `ListTimeSeriesResponse`
 * into them.
 *
 * The wire format is proto3 JSON, which has three habits a parser must know:
 * a 64-bit integer (`int64Value`, a distribution's `count`) arrives as a
 * **string**; a non-finite double arrives as the string `"NaN"`,
 * `"Infinity"` or `"-Infinity"`; and a field at its default value is left
 * out, so a distribution with no samples has no `mean`. Anything that does
 * not fit the documented shape is refused rather than guessed at, and the
 * refusal never quotes the value it could not read.
 *
 * @module
 */

import { isRecord, readArray, readString } from "./rest.ts";

/**
 * One point's value, by the metric's value type. A 64-bit integer is
 * returned as a `number` — exact up to 2^53, beyond which it rounds — with
 * the decimal string it arrived as beside it.
 */
export type CloudMonitoringValue =
  | {
    /** A `DOUBLE` metric. */
    kind: "double";
    /** The value; may be `NaN` or ±`Infinity`, which proto3 JSON can carry. */
    value: number;
  }
  | {
    /** An `INT64` metric. */
    kind: "int64";
    /** The value as a number. */
    value: number;
    /** The value exactly as the API sent it. */
    raw: string;
  }
  | {
    /** A `BOOL` metric. */
    kind: "bool";
    /** The value. */
    value: boolean;
  }
  | {
    /** A `STRING` metric. */
    kind: "string";
    /** The value. */
    value: string;
  }
  | {
    /** A `DISTRIBUTION` metric, summarised by its count and mean. */
    kind: "distribution";
    /** How many samples the distribution holds. */
    count: number;
    /** Their mean; `0` when there are none. */
    mean: number;
  };

/** One point of a time series: the interval it covers, and its value. */
export interface CloudMonitoringPoint {
  /** The start of the interval; absent for a `GAUGE` point. */
  start?: Date;
  /** The end of the interval — the time the point is for. */
  end: Date;
  /** The value. */
  value: CloudMonitoringValue;
}

/** A type and its labels: a metric, or a monitored resource. */
export interface CloudMonitoringLabelled {
  /** The metric type or resource type. */
  type: string;
  /** Its labels. */
  labels: Record<string, string>;
}

/** One time series: what it measures, on what, and its points, newest first. */
export interface CloudMonitoringTimeSeries {
  /** The metric and its labels. */
  metric: CloudMonitoringLabelled;
  /** The monitored resource and its labels. */
  resource: CloudMonitoringLabelled;
  /** `GAUGE`, `DELTA` or `CUMULATIVE`, as the API reports it. */
  metricKind?: string;
  /** `BOOL`, `INT64`, `DOUBLE`, `STRING` or `DISTRIBUTION`. */
  valueType?: string;
  /** The unit of the points, when the API reports one. */
  unit?: string;
  /** The points, newest first. Empty for a `HEADERS` view. */
  points: CloudMonitoringPoint[];
}

/** One page: its series, and the token of the next page, if any. */
export interface TimeSeriesPage {
  /** The series on this page. */
  series: CloudMonitoringTimeSeries[];
  /** The token for the next page; absent on the last. */
  nextPageToken?: string;
}

/** A refusal naming the reader and what did not fit, never the value. */
function unreadable(task: string, what: string): Error {
  return new Error(
    `${task}: Cloud Monitoring returned ${what}, which is not the documented ` +
      "shape of a time series list. Refused rather than guessed at.",
  );
}

/** A proto3 JSON 64-bit integer: a decimal string (or a plain number). */
function int64Of(value: unknown, task: string, what: string): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  throw unreadable(task, `an ${what} that is not an integer`);
}

/** A proto3 JSON double: a number, or one of the non-finite names. */
function doubleOf(value: unknown, task: string, what: string): number {
  if (typeof value === "number") return value;
  if (value === "NaN" || value === "Infinity" || value === "-Infinity") {
    return Number(value);
  }
  throw unreadable(task, `a ${what} that is not a number`);
}

/** The one value a `TypedValue` holds. */
function valueOf(value: unknown, task: string): CloudMonitoringValue {
  if (!isRecord(value)) throw unreadable(task, "a point with no value");
  if ("doubleValue" in value) {
    return {
      kind: "double",
      value: doubleOf(value.doubleValue, task, "doubleValue"),
    };
  }
  if ("int64Value" in value) {
    const raw = int64Of(value.int64Value, task, "int64Value");
    return { kind: "int64", value: Number(raw), raw };
  }
  if (typeof value.boolValue === "boolean") {
    return { kind: "bool", value: value.boolValue };
  }
  if (typeof value.stringValue === "string") {
    return { kind: "string", value: value.stringValue };
  }
  if (isRecord(value.distributionValue)) {
    const distribution = value.distributionValue;
    const count = distribution.count === undefined
      ? 0
      : Number(int64Of(distribution.count, task, "distribution count"));
    const mean = distribution.mean === undefined
      ? 0
      : doubleOf(distribution.mean, task, "distribution mean");
    return { kind: "distribution", count, mean };
  }
  throw unreadable(task, "a point whose value has no type it documents");
}

/** An RFC 3339 time from the API. */
function timeOf(value: unknown, task: string): Date {
  const time = typeof value === "string" ? new Date(value) : undefined;
  if (time === undefined || Number.isNaN(time.getTime())) {
    throw unreadable(task, "a point with no readable end time");
  }
  return time;
}

/** One point. */
function pointOf(point: unknown, task: string): CloudMonitoringPoint {
  if (!isRecord(point) || !isRecord(point.interval)) {
    throw unreadable(task, "a point with no interval");
  }
  const interval = point.interval;
  return {
    ...(interval.startTime === undefined
      ? {}
      : { start: timeOf(interval.startTime, task) }),
    end: timeOf(interval.endTime, task),
    value: valueOf(point.value, task),
  };
}

/** A string-valued label map; absent means none. */
function labelsOf(value: unknown, task: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw unreadable(task, "labels that are not a map");
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label !== "string") {
      throw unreadable(task, "a label that is not a string");
    }
    labels[key] = label;
  }
  return labels;
}

/** A metric or a resource: its type and labels. */
function labelledOf(value: unknown, task: string): CloudMonitoringLabelled {
  if (!isRecord(value)) return { type: "", labels: {} };
  return {
    type: readString(value, "type") ?? "",
    labels: labelsOf(value.labels, task),
  };
}

/** One series. */
function seriesOf(value: unknown, task: string): CloudMonitoringTimeSeries {
  if (!isRecord(value)) {
    throw unreadable(task, "a series that is not an object");
  }
  const metricKind = readString(value, "metricKind");
  const valueType = readString(value, "valueType");
  const unit = readString(value, "unit");
  return {
    metric: labelledOf(value.metric, task),
    resource: labelledOf(value.resource, task),
    ...(metricKind === undefined ? {} : { metricKind }),
    ...(valueType === undefined ? {} : { valueType }),
    ...(unit === undefined ? {} : { unit }),
    points: readArray(value, "points").map((point) => pointOf(point, task)),
  };
}

/**
 * One parsed page of a `ListTimeSeriesResponse`. An empty body is a page with
 * no series — the API's answer when nothing matched. A page that reports
 * `executionErrors` is refused: the API could not read every series, and a
 * partial answer judged as a whole is a silent truncation.
 */
export function timeSeriesPageOf(body: unknown, task: string): TimeSeriesPage {
  if (body === null) return { series: [] };
  if (!isRecord(body)) throw unreadable(task, "a page that is not an object");
  const errors = readArray(body, "executionErrors");
  if (errors.length > 0) {
    throw new Error(
      `${task}: Cloud Monitoring reported ${errors.length} execution ` +
        "error(s), so the answer is partial — some series could not be read. " +
        "Refused rather than judged as if it were whole.",
    );
  }
  const series = readArray(body, "timeSeries").map((item) =>
    seriesOf(item, task)
  );
  const nextPageToken = readString(body, "nextPageToken");
  return nextPageToken === undefined || nextPageToken === ""
    ? { series }
    : { series, nextPageToken };
}
