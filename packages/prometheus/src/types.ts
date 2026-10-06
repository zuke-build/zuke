// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The typed shapes of the Prometheus HTTP API's answers: the response
 * envelope, and the four expression result types — vector, matrix, scalar and
 * string — with their float and native-histogram samples.
 *
 * Names follow the API reference
 * (<https://prometheus.io/docs/prometheus/latest/querying/api/>): `resultType`,
 * `result`, `metric`, `values`, `histograms`, `warnings`, `infos`. The one
 * change is that a `[<unix_time>, "<sample_value>"]` pair becomes an object
 * with a parsed `timestamp` and `value`, because the API sends every sample
 * value as a string (`"NaN"`, `"+Inf"` and `"-Inf"` included) and a gate wants
 * a number.
 *
 * @module
 */

/** A label set: label name to label value, as the API's `metric` object. */
export type PrometheusLabels = Readonly<Record<string, string>>;

/** A time an API parameter accepts: a `Date`, Unix seconds, or RFC 3339 text. */
export type PrometheusTime = Date | number | string;

/**
 * A duration an API parameter accepts: Prometheus duration text such as
 * `"5m"`, or a number of seconds (the API's float form).
 */
export type PrometheusDuration = string | number;

/** The HTTP method for an endpoint the API serves on both `GET` and `POST`. */
export type PrometheusHttpMethod = "GET" | "POST";

/**
 * A successful API answer: the endpoint's typed `data`, plus the `warnings`
 * and `infos` annotations Prometheus attaches to a result it still returned.
 *
 * Both arrays are always present — empty when the server sent none — so a gate
 * can fail on `warnings.length > 0` without first checking for the key.
 */
export interface PrometheusResponse<T> {
  /** The endpoint's `data`, parsed into its typed shape. */
  readonly data: T;
  /** Problems that did not stop the request (`warnings` in the envelope). */
  readonly warnings: readonly string[];
  /** Info-level annotations about possible query issues (`infos`). */
  readonly infos: readonly string[];
}

/** One float sample at a point in time: a `[<unix_time>, "<value>"]` pair. */
export interface PrometheusPoint {
  /** The sample's time, in Unix seconds (fractional). */
  readonly timestamp: number;
  /** The sample value; `NaN`, `Infinity` and `-Infinity` are kept as such. */
  readonly value: number;
}

/** One bucket of a native histogram: `[<boundary_rule>, "<left>", "<right>", "<count>"]`. */
export interface PrometheusHistogramBucket {
  /**
   * Which boundaries are inclusive: `0` open left, `1` open right, `2` open
   * both, `3` closed both — the API's `<boundary_rule>`.
   */
  readonly boundaryRule: 0 | 1 | 2 | 3;
  /** The bucket's left boundary. */
  readonly lower: number;
  /** The bucket's right boundary. */
  readonly upper: number;
  /** The number of observations in the bucket. */
  readonly count: number;
}

/** A native histogram value, the API's `<histogram>` placeholder. */
export interface PrometheusHistogram {
  /** The count of observations. */
  readonly count: number;
  /** The sum of observations. */
  readonly sum: number;
  /** The populated buckets; empty when the server sent none. */
  readonly buckets: readonly PrometheusHistogramBucket[];
}

/** One native-histogram sample at a point in time: `[<unix_time>, <histogram>]`. */
export interface PrometheusHistogramPoint {
  /** The sample's time, in Unix seconds (fractional). */
  readonly timestamp: number;
  /** The histogram. */
  readonly histogram: PrometheusHistogram;
}

/** An instant-vector element whose sample is a float (the API's `value` key). */
export interface PrometheusFloatSample {
  /** The series' labels. */
  readonly metric: PrometheusLabels;
  /** The sample's time, in Unix seconds (fractional). */
  readonly timestamp: number;
  /** The sample value; `NaN`, `Infinity` and `-Infinity` are kept as such. */
  readonly value: number;
}

/** An instant-vector element whose sample is a native histogram (`histogram`). */
export interface PrometheusHistogramSample {
  /** The series' labels. */
  readonly metric: PrometheusLabels;
  /** The sample's time, in Unix seconds (fractional). */
  readonly timestamp: number;
  /** The histogram. */
  readonly histogram: PrometheusHistogram;
}

/**
 * One element of an instant vector. The API gives each element a `value` or a
 * `histogram`, never both — narrow with `"value" in sample`.
 */
export type PrometheusVectorSample =
  | PrometheusFloatSample
  | PrometheusHistogramSample;

/**
 * One series of a range vector. The API gives a series `values`, `histograms`,
 * or both; whichever is absent is an empty array here.
 */
export interface PrometheusSeries {
  /** The series' labels. */
  readonly metric: PrometheusLabels;
  /** The float samples, in time order. */
  readonly values: readonly PrometheusPoint[];
  /** The native-histogram samples, in time order. */
  readonly histograms: readonly PrometheusHistogramPoint[];
}

/** An instant vector: `resultType: "vector"`. */
export interface PrometheusVector {
  /** The result type. */
  readonly resultType: "vector";
  /** One element per series. */
  readonly result: readonly PrometheusVectorSample[];
}

/** A range vector: `resultType: "matrix"`. */
export interface PrometheusMatrix {
  /** The result type. */
  readonly resultType: "matrix";
  /** One entry per series. */
  readonly result: readonly PrometheusSeries[];
}

/** A scalar: `resultType: "scalar"`. */
export interface PrometheusScalar {
  /** The result type. */
  readonly resultType: "scalar";
  /** The scalar and the time it was evaluated at. */
  readonly result: PrometheusPoint;
}

/** A string: `resultType: "string"`. */
export interface PrometheusStringResult {
  /** The result type. */
  readonly resultType: "string";
  /** The string and the time it was evaluated at. */
  readonly result: {
    /** The evaluation time, in Unix seconds (fractional). */
    readonly timestamp: number;
    /** The string value. */
    readonly value: string;
  };
}

/**
 * The `data` of an expression query, discriminated on `resultType` exactly as
 * the API sends it.
 */
export type PrometheusQueryData =
  | PrometheusVector
  | PrometheusMatrix
  | PrometheusScalar
  | PrometheusStringResult;
