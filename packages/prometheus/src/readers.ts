// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Getting plain numbers out of a query result, so a gate does not unpack the
 * envelope: {@link readValue} for "the one number this query returns", and
 * {@link readSamples} for "every series' number".
 *
 * Both take float samples only. A native-histogram sample is refused by name
 * rather than reduced to a number — which number (count, sum, a quantile) is
 * the query's decision, made with `histogram_count(...)`,
 * `histogram_quantile(...)` and the like.
 *
 * @module
 */

import type {
  PrometheusFloatSample,
  PrometheusQueryData,
  PrometheusResponse,
} from "./types.ts";

/** The hint every "no samples" failure carries. */
const EMPTY_HINT = "append `or vector(0)` if no data means zero";

/**
 * Every float sample of an instant query: a vector's elements, or a scalar as
 * one sample with no labels. An empty vector is an empty list.
 *
 * @throws when the result is a matrix or a string, or holds a native
 *   histogram.
 */
export function readSamples(
  response: PrometheusResponse<PrometheusQueryData>,
): PrometheusFloatSample[] {
  const { data } = response;
  if (data.resultType === "scalar") {
    return [{ metric: {}, ...data.result }];
  }
  if (data.resultType !== "vector") {
    throw new Error(
      `expected a vector or scalar result, got ${data.resultType}`,
    );
  }
  return data.result.map((sample) => {
    if ("value" in sample) return sample;
    throw new Error(
      `the result holds a native histogram (${describe(sample.metric)}), ` +
        `not a float — reduce it in the query, e.g. with histogram_count(...) ` +
        `or histogram_quantile(...)`,
    );
  });
}

/**
 * The single number an instant query returns: a scalar, or a vector of
 * exactly one float sample. `NaN` and the infinities come back as such — they
 * are values Prometheus computed, and a bound check decides what they mean.
 *
 * @throws when the vector is empty or holds more than one sample, or the
 *   result is a matrix, a string, or a native histogram.
 */
export function readValue(
  response: PrometheusResponse<PrometheusQueryData>,
): number {
  const samples = readSamples(response);
  const [first] = samples;
  if (first === undefined) {
    throw new Error(`the query returned no samples — ${EMPTY_HINT}`);
  }
  if (samples.length > 1) {
    throw new Error(
      `the query returned ${samples.length} samples where one was expected ` +
        `(${describe(first.metric)}, …) — aggregate it with sum(...), ` +
        `max(...) or similar`,
    );
  }
  return first.value;
}

/** A label set as PromQL writes it, `{job="api"}`, for an error message. */
function describe(metric: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(metric).map(([name, value]) =>
    `${name}=${JSON.stringify(value)}`
  );
  return `{${pairs.join(", ")}}`;
}
