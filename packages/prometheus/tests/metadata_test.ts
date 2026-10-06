// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit: series, labels, label values (and the label-name path guard), metadata. */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { PrometheusRequestError, PrometheusTasks } from "../mod.ts";
import { escapeLabelName } from "../src/metadata.ts";
import { BASE, fakeFetch, success } from "./_fetch.ts";

Deno.test("series POSTs repeated match[] with its range and limit", async () => {
  const fetcher = fakeFetch(() =>
    success([{ __name__: "up", job: "api" }, { __name__: "up", job: "db" }])
  );
  const response = await PrometheusTasks.series((s) =>
    s.url(BASE).fetch(fetcher).match(
      "up",
      'process_start_time_seconds{job="p"}',
    )
      .start(1).end("2026-01-01T00:00:00Z").limit(5)
  );
  const [sent] = fetcher.sent;
  assertEquals(sent.method, "POST");
  assertEquals(sent.url.pathname, "/api/v1/series");
  assertEquals([...new URLSearchParams(sent.body)], [
    ["match[]", "up"],
    ["match[]", 'process_start_time_seconds{job="p"}'],
    ["start", "1"],
    ["end", "2026-01-01T00:00:00Z"],
    ["limit", "5"],
  ]);
  assertEquals(response.data, [{ __name__: "up", job: "api" }, {
    __name__: "up",
    job: "db",
  }]);
});

Deno.test("series needs a selector, and GET puts them in the URL", async () => {
  const fetcher = fakeFetch(() => success([]));
  await assertRejects(
    () => PrometheusTasks.series((s) => s.url(BASE).fetch(fetcher)),
    Error,
    "call s.match(...)",
  );
  await assertRejects(
    () => PrometheusTasks.series((s) => s.url(BASE).match("")),
    Error,
    "match(...) was given an empty value",
  );
  await PrometheusTasks.series((s) =>
    s.url(BASE).fetch(fetcher).match("up").httpMethod("GET")
  );
  assertEquals(fetcher.sent[0].url.searchParams.getAll("match[]"), ["up"]);
  assertEquals(fetcher.sent[0].method, "GET");
});

Deno.test("labels lists names, by POST or GET", async () => {
  const fetcher = fakeFetch(() => success(["__name__", "job"]));
  const response = await PrometheusTasks.labels((s) =>
    s.url(BASE).fetch(fetcher).match("up").start(1).end(2).limit(0)
  );
  assertEquals(response.data, ["__name__", "job"]);
  assertEquals(fetcher.sent[0].url.pathname, "/api/v1/labels");
  assertEquals(fetcher.sent[0].body, "match%5B%5D=up&start=1&end=2&limit=0");
  await PrometheusTasks.labels((s) =>
    s.url(BASE).fetch(fetcher).httpMethod("GET")
  );
  assertEquals(fetcher.sent[1].method, "GET");
  assertEquals(fetcher.sent[1].url.search, "");
});

Deno.test("labelValues GETs the label's path with its selection", async () => {
  const fetcher = fakeFetch(() => success(["200", "504"]));
  const response = await PrometheusTasks.labelValues((s) =>
    s.url(BASE).fetch(fetcher).labelName("http_status_code").start(1)
  );
  assertEquals(response.data, ["200", "504"]);
  assertEquals(fetcher.sent[0].method, "GET");
  assertEquals(
    fetcher.sent[0].url.href,
    `${BASE}/api/v1/label/http_status_code/values?start=1`,
  );
  await assertRejects(
    () => PrometheusTasks.labelValues((s) => s.url(BASE).fetch(fetcher)),
    Error,
    "call s.labelName(...)",
  );
});

Deno.test("a UTF-8 label name is sent in the API's U__ escape", async () => {
  const fetcher = fakeFetch(() => success([]));
  await PrometheusTasks.labelValues((s) =>
    s.url(BASE).fetch(fetcher).labelName("http.status_code")
  );
  // The reference's own example.
  assertEquals(
    fetcher.sent[0].url.pathname,
    "/api/v1/label/U__http_2e_status__code/values",
  );
});

Deno.test("a label name cannot traverse out of its path segment", async () => {
  const fetcher = fakeFetch(() => success([]));
  for (
    const name of [
      "../../admin/tsdb/snapshot",
      "%2e%2e/x",
      "a/b",
      "a?b#c",
      "..",
      "a\\b",
    ]
  ) {
    await PrometheusTasks.labelValues((s) =>
      s.url(`${BASE}/prom`).fetch(fetcher).labelName(name)
    );
    const sent = fetcher.sent[fetcher.sent.length - 1];
    const segments = sent.url.pathname.split("/");
    assertEquals(segments.length, 7, sent.url.pathname);
    assertEquals(segments.slice(0, 5), ["", "prom", "api", "v1", "label"]);
    assertEquals(segments[6], "values");
    assertEquals(/^U__[A-Za-z0-9_:]+$/.test(segments[5]), true, segments[5]);
    assertEquals(sent.url.search, "");
  }
});

Deno.test("escapeLabelName matches prometheus/common's value-encoding escape", () => {
  const cases: Array<[string, string]> = [
    ["job", "job"],
    ["__name__", "__name__"],
    ["a:b", "a:b"],
    ["http.status_code", "U__http_2e_status__code"],
    ["0abc", "U___30_abc"],
    ["a0", "a0"],
    ["ünï", "U___fc_n_ef_"],
    ["a b", "U__a_20_b"],
    ["😀", "U___1f600_"],
    ["\ud800", "U___FFFD_"],
  ];
  for (const [name, escaped] of cases) {
    assertEquals(escapeLabelName(name), escaped, name);
  }
});

Deno.test("metadata GETs its filters and answers metadata keyed by metric", async () => {
  // Raw JSON, so `__proto__` arrives as an own key the way a server sends it.
  const fetcher = fakeFetch(() =>
    new Response(
      '{"status":"success","data":{"http_requests_total":[{"type":"counter",' +
        '"help":"Number of HTTP requests","unit":""}],' +
        '"__proto__":[{"type":"gauge","help":"odd","unit":""}]}}',
    )
  );
  const response = await PrometheusTasks.metadata((s) =>
    s.url(BASE).fetch(fetcher).limit(2).limitPerMetric(1)
      .metric("http_requests_total")
  );
  assertEquals(
    fetcher.sent[0].url.search,
    "?limit=2&limit_per_metric=1&metric=http_requests_total",
  );
  assertEquals(response.data.http_requests_total, [
    { type: "counter", help: "Number of HTTP requests", unit: "" },
  ]);
  assertEquals(Object.keys(response.data), [
    "http_requests_total",
    "__proto__",
  ]);
  assertEquals(Object.getPrototypeOf(response.data), Object.prototype);
  await assertRejects(
    () =>
      PrometheusTasks.metadata((s) =>
        s.url(BASE).fetch(fakeFetch(() => success({ m: [{ type: "x" }] })))
      ),
    PrometheusRequestError,
    "a metadata entry of m has no help",
  );
  await assertRejects(
    () => PrometheusTasks.metadata((s) => s.metric("")),
    Error,
    "metric(...) was given an empty value",
  );
});

Deno.test("malformed metadata answers are refused", async () => {
  const cases: Array<[() => Promise<unknown>, string]> = [
    [
      () =>
        PrometheusTasks.series((s) =>
          s.url(BASE).match("up").fetch(fakeFetch(() => success([1])))
        ),
      "a series is not an object",
    ],
    [
      () =>
        PrometheusTasks.labels((s) =>
          s.url(BASE).fetch(fakeFetch(() => success([1])))
        ),
      "holds a value that is not a string",
    ],
    [
      () =>
        PrometheusTasks.metadata((s) =>
          s.url(BASE).fetch(fakeFetch(() => success([])))
        ),
      "the metadata is not an object",
    ],
  ];
  for (const [call, message] of cases) {
    await assertRejects(call, PrometheusRequestError, message);
  }
});
