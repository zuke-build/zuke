// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit: instant and range queries — the exact request, and every result type. */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { PrometheusRequestError, PrometheusTasks } from "../mod.ts";
import { BASE, fakeFetch, queryResult, success, vector } from "./_fetch.ts";

Deno.test("query POSTs a form with every parameter it was given", async () => {
  const fetcher = fakeFetch(() => vector([{ job: "api" }, "1"]));
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fetcher)
      .query('sum(rate(http_requests_total{code=~"5.."}[5m]))')
      .time(new Date("2026-01-02T03:04:05Z")).timeout("30s").limit(10)
      .lookbackDelta(120)
  );
  const [sent] = fetcher.sent;
  assertEquals(sent.method, "POST");
  assertEquals(sent.url.href, `${BASE}/api/v1/query`);
  assertEquals(
    sent.headers.get("content-type"),
    "application/x-www-form-urlencoded",
  );
  assertEquals(sent.headers.get("accept"), "application/json");
  assertEquals(sent.redirect, "manual");
  const form = new URLSearchParams(sent.body);
  assertEquals([...form], [
    ["query", 'sum(rate(http_requests_total{code=~"5.."}[5m]))'],
    ["time", "2026-01-02T03:04:05.000Z"],
    ["timeout", "30s"],
    ["limit", "10"],
    ["lookback_delta", "120"],
  ]);
});

Deno.test("query with httpMethod GET puts the parameters in the URL, encoded", async () => {
  const fetcher = fakeFetch(() => vector());
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fetcher).httpMethod("GET").query("a & b = c#d").time(17)
  );
  const [sent] = fetcher.sent;
  assertEquals(sent.method, "GET");
  assertEquals(sent.body, "");
  assertEquals(sent.headers.get("content-type"), null);
  assertEquals(sent.url.searchParams.get("query"), "a & b = c#d");
  assertEquals(sent.url.searchParams.get("time"), "17");
  assertEquals(sent.url.hash, "");
});

Deno.test("query_range sends its range and answers a typed matrix", async () => {
  const fetcher = fakeFetch(() =>
    queryResult("matrix", [{
      metric: { job: "api" },
      values: [[1, "1"], [2, "NaN"]],
      histograms: [[2, { count: "3", sum: "4.5" }]],
    }, { metric: {}, values: [[1, "+Inf"]] }])
  );
  const response = await PrometheusTasks.queryRange((s) =>
    s.url(BASE).fetch(fetcher).query("up").start("2026-01-01T00:00:00Z")
      .end(1767225660).step("15s").timeout(5).limit(0).lookbackDelta("1m")
  );
  assertEquals([...new URLSearchParams(fetcher.sent[0].body)], [
    ["query", "up"],
    ["start", "2026-01-01T00:00:00Z"],
    ["end", "1767225660"],
    ["step", "15s"],
    ["timeout", "5"],
    ["limit", "0"],
    ["lookback_delta", "1m"],
  ]);
  assertEquals(fetcher.sent[0].url.pathname, "/api/v1/query_range");
  const [first, second] = response.data.result;
  assertEquals(first.metric, { job: "api" });
  assertEquals(first.values[0], { timestamp: 1, value: 1 });
  assertEquals(Number.isNaN(first.values[1].value), true);
  assertEquals(first.histograms, [{
    timestamp: 2,
    histogram: { count: 3, sum: 4.5, buckets: [] },
  }]);
  assertEquals(second.values, [{ timestamp: 1, value: Infinity }]);
  assertEquals(second.histograms, []);
});

Deno.test("a matrix series with only native histograms has no float values", async () => {
  const response = await PrometheusTasks.queryRange((s) =>
    s.url(BASE).query("h").start(1).end(2).step(1).fetch(
      fakeFetch(() =>
        queryResult("matrix", [{
          metric: {},
          histograms: [[1, { count: "1", sum: "2", buckets: [] }]],
        }])
      ),
    )
  );
  const [series] = response.data.result;
  assertEquals(series.values, []);
  assertEquals(series.histograms[0].histogram.count, 1);
});

Deno.test("a range query answering anything but a matrix is refused", async () => {
  await assertRejects(
    () =>
      PrometheusTasks.queryRange((s) =>
        s.url(BASE).fetch(fakeFetch(() => vector())).query("up").start(1)
          .end(2).step(1)
      ),
    PrometheusRequestError,
    "answered with a vector, not a matrix",
  );
});

Deno.test("a range query without its range or an expression is refused before sending", async () => {
  const fetcher = fakeFetch(() => vector());
  await assertRejects(
    () =>
      PrometheusTasks.queryRange((s) =>
        s.url(BASE).fetch(fetcher).query("up").start(1)
      ),
    Error,
    "s.start(...), s.end(...) and s.step(...)",
  );
  await assertRejects(
    () => PrometheusTasks.query((s) => s.url(BASE).fetch(fetcher)),
    Error,
    "call s.query(...)",
  );
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("every result type is parsed: vector, scalar, string, and native histograms", async () => {
  const answer = async (response: Response) =>
    await PrometheusTasks.query((s) =>
      s.url(BASE).fetch(fakeFetch(() => response)).query("q")
    );
  const vectorResult = await answer(queryResult("vector", [
    { metric: { a: "1" }, value: [1.5, "-Inf"] },
    {
      metric: { a: "2" },
      histogram: [2, {
        count: "10",
        sum: "+Inf",
        buckets: [[0, "0", "1", "4"], [3, "-1e-3", "1e-3", "6"]],
      }],
    },
  ]));
  assertEquals(vectorResult.data.resultType, "vector");
  if (vectorResult.data.resultType === "vector") {
    const [float, histogram] = vectorResult.data.result;
    assertEquals(float, {
      metric: { a: "1" },
      timestamp: 1.5,
      value: -Infinity,
    });
    assertEquals(histogram, {
      metric: { a: "2" },
      timestamp: 2,
      histogram: {
        count: 10,
        sum: Infinity,
        buckets: [
          { boundaryRule: 0, lower: 0, upper: 1, count: 4 },
          { boundaryRule: 3, lower: -0.001, upper: 0.001, count: 6 },
        ],
      },
    });
  }
  assertEquals(
    (await answer(queryResult("scalar", [3, "0.25"]))).data,
    { resultType: "scalar", result: { timestamp: 3, value: 0.25 } },
  );
  assertEquals(
    (await answer(queryResult("string", [4, "hello"]))).data,
    { resultType: "string", result: { timestamp: 4, value: "hello" } },
  );
});

Deno.test("warnings and infos come back with the result; absent ones are empty", async () => {
  const annotated = await PrometheusTasks.query((s) =>
    s.url(BASE).query("q").fetch(
      fakeFetch(() =>
        success({ resultType: "scalar", result: [1, "1"] }, {
          warnings: ["PromQL warning: x"],
          infos: ["PromQL info: y"],
        })
      ),
    )
  );
  assertEquals(annotated.warnings, ["PromQL warning: x"]);
  assertEquals(annotated.infos, ["PromQL info: y"]);
  const plain = await PrometheusTasks.query((s) =>
    s.url(BASE).query("q").fetch(fakeFetch(() => vector()))
  );
  assertEquals(plain.warnings, []);
  assertEquals(plain.infos, []);
});

Deno.test("a malformed query result names what is wrong", async () => {
  const cases: Array<[unknown, string]> = [
    [
      { resultType: "vector", result: [{ value: [1, 2] }] },
      "[timestamp, value] pair",
    ],
    [
      { resultType: "vector", result: [{ value: ["1", "2"] }] },
      "[timestamp, value] pair",
    ],
    [
      { resultType: "vector", result: [{ value: [1, "x"] }] },
      'is not a number: "x"',
    ],
    [{ resultType: "vector", result: [{ value: [1, ""] }] }, "is not a number"],
    [
      { resultType: "vector", result: [{ value: [1, "0x10"] }] },
      "is not a number",
    ],
    [
      { resultType: "vector", result: [{ value: [1, "1"] }] },
      "metric is not an object",
    ],
    [
      { resultType: "vector", result: [{ metric: { a: 1 }, value: [1, "1"] }] },
      "label a that is not a string",
    ],
    [{ resultType: "vector", result: {} }, "a vector result is not an array"],
    [
      { resultType: "string", result: [1, 2] },
      "a string result has no [timestamp, value] pair",
    ],
    [{ resultType: "histogram", result: [] }, 'unknown resultType "histogram"'],
    [{ result: [] }, "the query data has no resultType"],
    ["nope", "the query data is not an object"],
    [{
      resultType: "vector",
      result: [{ metric: {}, histogram: [1, { count: "1" }] }],
    }, "has no sum"],
    [{
      resultType: "vector",
      result: [{
        metric: {},
        histogram: [1, { count: "1", sum: "1", buckets: [[9, "0", "1", "1"]] }],
      }],
    }, "[boundary_rule, left, right, count] bucket"],
    [{
      resultType: "vector",
      result: [{
        metric: {},
        histogram: [1, { count: "1", sum: "1", buckets: [[0, 0, "1", "1"]] }],
      }],
    }, "[boundary_rule, left, right, count] bucket"],
    [
      { resultType: "matrix", result: [{ metric: {}, values: {} }] },
      "values is not an array",
    ],
    [
      { resultType: "vector", result: [{ metric: {}, value: "1" }] },
      "a sample has no [timestamp, value] pair",
    ],
    [
      { resultType: "vector", result: [{ metric: {}, value: [1, "1", 2] }] },
      "a sample has no [timestamp, value] pair",
    ],
  ];
  for (const [data, message] of cases) {
    await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(BASE).query("q").fetch(fakeFetch(() => success(data)))
        ),
      PrometheusRequestError,
      message,
    );
  }
});

Deno.test("annotations that are not lists of strings are refused", async () => {
  for (const extra of [{ warnings: "x" }, { infos: [1] }]) {
    await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(BASE).query("q").fetch(
            fakeFetch(() =>
              success({ resultType: "scalar", result: [1, "1"] }, extra)
            ),
          )
        ),
      PrometheusRequestError,
      "unexpected answer",
    );
  }
});

Deno.test("query parameters are checked where they are set", async () => {
  const cases: Array<[() => unknown, string]> = [
    [
      () => PrometheusTasks.query((s) => s.query("")),
      "query(...) was given an empty value",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").limit(-1)),
      "limit(...) must be a whole number",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").limit(1.5)),
      "limit(...) must be a whole number",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").timeout(0)),
      "timeout(...) must be a positive",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").timeout("")),
      "timeout(...) was given an empty value",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").time(new Date("nope"))),
      "invalid Date",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").time(Infinity)),
      "finite Unix seconds",
    ],
    [
      () => PrometheusTasks.query((s) => s.query("q").time("")),
      "time(...) was given an empty value",
    ],
  ];
  for (const [call, message] of cases) {
    const error = await assertRejects(async () => await call(), Error);
    assertStringIncludes(error.message, message);
  }
});
