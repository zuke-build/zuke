// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit tests for `prometheus(...)`, answered by a fake `fetch`. */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { prometheus, type PrometheusSettings } from "../mod.ts";
import { analysisContext, fakeFetch } from "./_context.ts";

/** A successful instant-query response. */
function result(resultType: string, result: unknown): Response {
  return Response.json({ status: "success", data: { resultType, result } });
}

/** A vector of the given sample values. */
function vector(...values: string[]): Response {
  return result(
    "vector",
    values.map((v) => ({ metric: {}, value: [1700000000, v] })),
  );
}

Deno.test("a vector within bounds passes, and the query is sent encoded with headers", async () => {
  const fetcher = fakeFetch(() => vector("0.001", "0.004"));
  await prometheus((p) =>
    p.url("https://prom.example/").query('rate(errors{rev="canary"}[5m])')
      .max(0.01).header("Authorization", "Bearer t").timeout("10s")
      .fetch(fetcher)
  ).validate(analysisContext());
  assertEquals(
    fetcher.urls[0],
    "https://prom.example/api/v1/query?query=" +
      encodeURIComponent('rate(errors{rev="canary"}[5m])'),
  );
  assertEquals(fetcher.headers[0].get("Authorization"), "Bearer t");
});

Deno.test("a scalar result is judged too", async () => {
  await assertRejects(
    async () =>
      await prometheus((p) =>
        p.name("p99 latency").url("https://prom.example").query("q").max(0.5)
          .fetch(fakeFetch(() => result("scalar", [1700000000, "0.9"])))
      ).validate(analysisContext()),
    Error,
    "p99 latency is 0.9, above the maximum 0.5",
  );
});

Deno.test("any sample out of bounds fails, and the message is redacted", async () => {
  const error = await assertRejects(
    async () =>
      await prometheus((p) =>
        p.name("errors s3cr3t").url("https://prom.example").query("q").min(1)
          .fetch(fakeFetch(() => vector("5", "0")))
      ).validate(analysisContext()),
    Error,
  );
  assertStringIncludes(
    String(error),
    "errors [redacted] is 0, below the minimum 1",
  );
});

Deno.test("an unreadable answer fails with the reason, redacted", async () => {
  const cases: Array<[Response, string]> = [
    [vector(), "returned no samples"],
    [result("matrix", []), "expected a vector or scalar result, got matrix"],
    [result("vector", [{ value: [1, 2] }]), "has no [timestamp, value] pair"],
    [
      Response.json({ status: "error", error: "bad query" }),
      "query failed: bad query",
    ],
    [
      Response.json({ status: "error", error: "unauthorised" }, {
        status: 401,
      }),
      "HTTP 401: unauthorised",
    ],
    [Response.json({}, { status: 500 }), "HTTP 500"],
    [new Response("<html>"), "could not be read"],
  ];
  for (const [response, message] of cases) {
    const error = await assertRejects(
      async () =>
        await prometheus((p) =>
          p.url("https://prom.example/s3cr3t").query("q").max(1)
            .fetch(fakeFetch(() => response.clone()))
        ).validate(analysisContext()),
      Error,
    );
    assertStringIncludes(String(error), message);
    assertEquals(String(error).includes("s3cr3t"), false);
  }
});

Deno.test("a query with no URL, no query or no bound is refused", async () => {
  for (
    const [configure, message] of [
      [
        (p: PrometheusSettings) => p.query("q").max(1),
        "needs a URL and a query",
      ],
      [
        (p: PrometheusSettings) => p.url("u").max(1),
        "needs a URL and a query",
      ],
      [
        (p: PrometheusSettings) => p.url("u").query("q"),
        "sets no bound",
      ],
    ] as const
  ) {
    await assertRejects(
      async () => await prometheus(configure).validate(analysisContext()),
      Error,
      message,
    );
  }
});
