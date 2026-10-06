// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Parsing an expression query's `data` into {@link PrometheusQueryData}: the
 * sample-value strings into numbers, the `[time, value]` pairs into points,
 * and native histograms into their typed form.
 *
 * @module
 */

import { own, readArray, readLabels, readRecord, readString } from "./shape.ts";
import type {
  PrometheusHistogram,
  PrometheusHistogramBucket,
  PrometheusHistogramPoint,
  PrometheusPoint,
  PrometheusQueryData,
  PrometheusSeries,
  PrometheusVectorSample,
} from "./types.ts";

/**
 * A decimal float as Go's `strconv.FormatFloat` writes one — which is how
 * Prometheus renders every sample value. Matched explicitly because `Number`
 * is far more forgiving: it reads `""` and `" "` as `0`, and `"0x10"` as 16, so
 * a garbled value would pass as a plausible reading instead of failing.
 */
const FLOAT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A Prometheus sample value, which the API sends as a string because JSON has
 * no `NaN` or infinities. `"NaN"` stays `NaN` — a ratio over no traffic is
 * 0/0 — and `"+Inf"`/`"-Inf"` (and Go's unsigned `"Inf"`) become infinities.
 */
export function parseSampleValue(text: string, what: string): number {
  if (text === "NaN") return Number.NaN;
  if (text === "+Inf" || text === "Inf") return Number.POSITIVE_INFINITY;
  if (text === "-Inf") return Number.NEGATIVE_INFINITY;
  if (!FLOAT.test(text)) {
    throw new Error(`${what} is not a number: ${JSON.stringify(text)}`);
  }
  return Number(text);
}

/** A `[<unix_time>, <x>]` pair's two halves, with the time checked. */
function pairOf(value: unknown, what: string): [number, unknown] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${what} has no [timestamp, value] pair`);
  }
  const [timestamp, sample] = value;
  if (typeof timestamp !== "number") {
    throw new Error(`${what} has no [timestamp, value] pair`);
  }
  return [timestamp, sample];
}

/** A `[<unix_time>, "<value>"]` pair as a point. */
function parsePoint(value: unknown, what: string): PrometheusPoint {
  const [timestamp, sample] = pairOf(value, what);
  if (typeof sample !== "string") {
    throw new Error(`${what} has no [timestamp, value] pair`);
  }
  return { timestamp, value: parseSampleValue(sample, what) };
}

/** Whether `rule` is one of the four documented boundary rules. */
function isBoundaryRule(rule: number): rule is 0 | 1 | 2 | 3 {
  return rule === 0 || rule === 1 || rule === 2 || rule === 3;
}

/** One `[<boundary_rule>, "<left>", "<right>", "<count>"]` bucket. */
function parseBucket(value: unknown, what: string): PrometheusHistogramBucket {
  const bucket = readArray(value, what);
  const [rule, lower, upper, count] = bucket;
  if (
    bucket.length !== 4 || typeof rule !== "number" || !isBoundaryRule(rule) ||
    typeof lower !== "string" || typeof upper !== "string" ||
    typeof count !== "string"
  ) {
    throw new Error(
      `${what} is not a [boundary_rule, left, right, count] bucket`,
    );
  }
  return {
    boundaryRule: rule,
    lower: parseSampleValue(lower, `${what} left boundary`),
    upper: parseSampleValue(upper, `${what} right boundary`),
    count: parseSampleValue(count, `${what} count`),
  };
}

/** A native histogram object. */
function parseHistogram(
  value: unknown,
  what: string,
): PrometheusHistogram {
  const object = readRecord(value, what);
  const buckets = own(object, "buckets");
  return {
    count: parseSampleValue(readString(object, "count", what), `${what} count`),
    sum: parseSampleValue(readString(object, "sum", what), `${what} sum`),
    buckets: buckets === undefined ? [] : readArray(buckets, `${what} buckets`)
      .map((bucket) => parseBucket(bucket, `${what} bucket`)),
  };
}

/** A `[<unix_time>, <histogram>]` pair. */
function parseHistogramPoint(
  value: unknown,
  what: string,
): PrometheusHistogramPoint {
  const [timestamp, histogram] = pairOf(value, what);
  return {
    timestamp,
    histogram: parseHistogram(histogram, `${what} histogram`),
  };
}

/** One element of an instant vector: a float `value` or a `histogram`. */
function parseVectorSample(value: unknown): PrometheusVectorSample {
  const object = readRecord(value, "a vector sample");
  const pair = own(object, "value");
  const histogram = own(object, "histogram");
  if (pair === undefined && histogram !== undefined) {
    const point = parseHistogramPoint(histogram, "a histogram sample");
    return {
      metric: readLabels(own(object, "metric"), "a histogram sample's metric"),
      ...point,
    };
  }
  const point = parsePoint(pair, "a sample");
  return {
    metric: readLabels(own(object, "metric"), "a sample's metric"),
    ...point,
  };
}

/** One series of a range vector. */
function parseSeries(value: unknown): PrometheusSeries {
  const object = readRecord(value, "a matrix series");
  const values = own(object, "values");
  const histograms = own(object, "histograms");
  return {
    metric: readLabels(own(object, "metric"), "a matrix series' metric"),
    values: values === undefined
      ? []
      : readArray(values, "a matrix series' values")
        .map((point) => parsePoint(point, "a matrix value")),
    histograms: histograms === undefined
      ? []
      : readArray(histograms, "a matrix series' histograms")
        .map((point) => parseHistogramPoint(point, "a matrix histogram")),
  };
}

/** An expression query's `data`, discriminated on `resultType`. */
export function parseQueryData(value: unknown): PrometheusQueryData {
  const data = readRecord(value, "the query data");
  const resultType = readString(data, "resultType", "the query data");
  const result = own(data, "result");
  switch (resultType) {
    case "vector":
      return {
        resultType,
        result: readArray(result, "a vector result").map(parseVectorSample),
      };
    case "matrix":
      return {
        resultType,
        result: readArray(result, "a matrix result").map(parseSeries),
      };
    case "scalar":
      return { resultType, result: parsePoint(result, "a scalar result") };
    case "string": {
      const [timestamp, text] = pairOf(result, "a string result");
      if (typeof text !== "string") {
        throw new Error("a string result has no [timestamp, value] pair");
      }
      return { resultType, result: { timestamp, value: text } };
    }
    default:
      throw new Error(
        `the query data has an unknown resultType ${
          JSON.stringify(resultType)
        }`,
      );
  }
}
