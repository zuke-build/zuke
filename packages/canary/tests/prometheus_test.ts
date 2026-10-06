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
  const sent = new URL(fetcher.urls[0]);
  assertEquals(
    sent.origin + sent.pathname,
    "https://prom.example/api/v1/query",
  );
  assertEquals(
    sent.searchParams.get("query"),
    'rate(errors{rev="canary"}[5m])',
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

Deno.test("a base URL's path and query string are kept", async () => {
  const fetcher = fakeFetch(() => vector("0"));
  await prometheus((p) =>
    p.url("https://proxy.example/prom/?org=7").query("up").max(1).fetch(fetcher)
  ).validate(analysisContext());
  const sent = new URL(fetcher.urls[0]);
  assertEquals(sent.pathname, "/prom/api/v1/query");
  assertEquals(sent.searchParams.get("org"), "7");
  assertEquals(sent.searchParams.get("query"), "up");
});

Deno.test("an HTML error page reports its status, not a JSON parse error", async () => {
  await assertRejects(
    async () =>
      await prometheus((p) =>
        p.url("https://prom.example").query("q").max(1)
          .fetch(
            fakeFetch(() => new Response("<html>bad gateway", { status: 502 })),
          )
      ).validate(analysisContext()),
    Error,
    "could not be read: HTTP 502",
  );
});

Deno.test("infinite samples are judged as infinities, NaN as not a number", async () => {
  const judge = async (value: string) =>
    await prometheus((p) =>
      p.name("ratio").url("https://prom.example").query("q").max(1)
        .fetch(fakeFetch(() => vector(value)))
    ).validate(analysisContext());
  await assertRejects(
    () => judge("+Inf"),
    Error,
    "ratio is Infinity, above the maximum 1",
  );
  await assertRejects(() => judge("NaN"), Error, "ratio is not a number");
  await prometheus((p) =>
    p.url("https://prom.example").query("q").max(1)
      .fetch(fakeFetch(() => vector("-Inf")))
  ).validate(analysisContext());
});

Deno.test("an unauthenticated in-cluster http URL is queried, as it always was", async () => {
  const fetcher = fakeFetch(() => vector("0.001"));
  await prometheus((p) =>
    p.url("http://prometheus.monitoring.svc:9090").query("q").max(0.01)
      .fetch(fetcher)
  ).validate(analysisContext());
  assertEquals(
    new URL(fetcher.urls[0]).origin,
    "http://prometheus.monitoring.svc:9090",
  );
});

Deno.test("credentials in a URL never reach the failure message", async () => {
  const error = await assertRejects(
    async () =>
      await prometheus((p) =>
        p.url("https://admin:hunter2@prom.example/?token=abc").query("q").max(1)
          .fetch(
            fakeFetch((url) =>
              Promise.reject(
                new TypeError(`error sending request for url (${url})`),
              )
            ),
          )
      ).validate(analysisContext()),
    Error,
  );
  assertStringIncludes(String(error), "https://prom.example/api/v1/query");
  for (const secret of ["hunter2", "admin", "token=abc"]) {
    assertEquals(String(error).includes(secret), false, secret);
  }
});

Deno.test("the run's cancellation is not reported as an unreadable query", async () => {
  const stop = new AbortController();
  const fetcher = fakeFetch(() => {
    stop.abort(new Error("run cancelled"));
    return Promise.reject(new DOMException("aborted", "AbortError"));
  });
  await assertRejects(
    async () =>
      await prometheus((p) =>
        p.url("https://prom.example").query("q").max(1).fetch(fetcher)
      )
        .validate(analysisContext(stop.signal)),
    Error,
    "run cancelled",
  );
});
