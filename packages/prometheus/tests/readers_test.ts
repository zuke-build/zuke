// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit: the `value` and `samples` readers and their edge cases. */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  type PrometheusQueryData,
  type PrometheusResponse,
  PrometheusTasks,
} from "../mod.ts";

/** A response around `data`. */
function response(
  data: PrometheusQueryData,
): PrometheusResponse<PrometheusQueryData> {
  return { data, warnings: [], infos: [] };
}

/** A vector of float samples. */
function vectorOf(...values: number[]): PrometheusQueryData {
  return {
    resultType: "vector",
    result: values.map((value, i) => ({
      metric: { i: String(i) },
      timestamp: 1,
      value,
    })),
  };
}

const HISTOGRAM: PrometheusQueryData = {
  resultType: "vector",
  result: [{
    metric: { job: "api" },
    timestamp: 1,
    histogram: { count: 1, sum: 1, buckets: [] },
  }],
};

Deno.test("value reads a scalar and a one-sample vector, NaN and infinities included", () => {
  assertEquals(
    PrometheusTasks.value(response({
      resultType: "scalar",
      result: { timestamp: 1, value: 0.5 },
    })),
    0.5,
  );
  assertEquals(PrometheusTasks.value(response(vectorOf(2))), 2);
  assertEquals(PrometheusTasks.value(response(vectorOf(-Infinity))), -Infinity);
  assertEquals(
    Number.isNaN(PrometheusTasks.value(response(vectorOf(NaN)))),
    true,
  );
});

Deno.test("value fails clearly on no samples, several, or a non-float result", () => {
  const cases: Array<[PrometheusQueryData, string]> = [
    [vectorOf(), "returned no samples — append `or vector(0)`"],
    [
      vectorOf(1, 2, 3),
      'returned 3 samples where one was expected ({i="0"}, …)',
    ],
    [
      { resultType: "matrix", result: [] },
      "expected a vector or scalar result, got matrix",
    ],
    [
      { resultType: "string", result: { timestamp: 1, value: "x" } },
      "expected a vector or scalar result, got string",
    ],
    [HISTOGRAM, 'native histogram ({job="api"}), not a float'],
  ];
  for (const [data, message] of cases) {
    const error = assertThrows(() => PrometheusTasks.value(response(data)));
    assertStringIncludes(error.message, message);
  }
});

Deno.test("samples lists every float sample with its labels", () => {
  assertEquals(PrometheusTasks.samples(response(vectorOf(1, 2))), [
    { metric: { i: "0" }, timestamp: 1, value: 1 },
    { metric: { i: "1" }, timestamp: 1, value: 2 },
  ]);
  assertEquals(PrometheusTasks.samples(response(vectorOf())), []);
  assertEquals(
    PrometheusTasks.samples(response({
      resultType: "scalar",
      result: { timestamp: 4, value: 7 },
    })),
    [{ metric: {}, timestamp: 4, value: 7 }],
  );
  assertThrows(
    () => PrometheusTasks.samples(response(HISTOGRAM)),
    Error,
    "histogram_quantile",
  );
});
