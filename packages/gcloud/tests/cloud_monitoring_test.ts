// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { HttpError } from "@zuke/core";
import { CommandOutput } from "@zuke/core/shell";
import {
  CloudMonitoringMetricValueSettings,
  CloudMonitoringTasks,
  CloudMonitoringTimeSeriesSettings,
  type GcloudSettings,
} from "../mod.ts";
import { NOW, pages, point, series, TOKEN } from "./_monitoring.ts";

/** A read of the Cloud Run 5xx count, with the fakes the tests share. */
function fiveXx<S extends CloudMonitoringTimeSeriesSettings>(
  s: S,
  fetch: typeof globalThis.fetch,
): S {
  return s.project("p").token(TOKEN).fetch(fetch).now(NOW)
    .metricType("run.googleapis.com/request_count")
    .resourceType("cloud_run_revision")
    .resourceLabel("revision_name", "api-00002")
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM").groupByFields(
      "resource.labels.revision_name",
    )
    .window("5m");
}

Deno.test("timeSeriesList sends the documented query, with the token as a bearer header", async () => {
  const fake = pages({ timeSeries: [series([1, 2])] });
  const result = await CloudMonitoringTasks.timeSeriesList((s) =>
    fiveXx(s, fake.fetch).pageSize(500)
  );
  const url = fake.urls[0];
  assertEquals(
    url.origin + url.pathname,
    "https://monitoring.googleapis.com/v3/projects/p/timeSeries",
  );
  const q = url.searchParams;
  assertEquals(
    q.get("filter"),
    'metric.type = "run.googleapis.com/request_count" AND ' +
      'resource.type = "cloud_run_revision" AND ' +
      'resource.labels.revision_name = "api-00002" AND ' +
      'metric.labels.response_code_class = "5xx"',
  );
  // The window ends at the last whole minute before 12:10:30.
  assertEquals(q.get("interval.endTime"), "2026-10-07T12:10:00.000Z");
  assertEquals(q.get("interval.startTime"), "2026-10-07T12:05:00.000Z");
  assertEquals(q.get("aggregation.alignmentPeriod"), "60s");
  assertEquals(q.get("aggregation.perSeriesAligner"), "ALIGN_SUM");
  assertEquals(q.get("aggregation.crossSeriesReducer"), "REDUCE_SUM");
  assertEquals(q.getAll("aggregation.groupByFields"), [
    "resource.labels.revision_name",
  ]);
  assertEquals(q.get("view"), "FULL");
  assertEquals(q.get("pageSize"), "500");
  assertEquals(fake.headers[0].get("authorization"), `Bearer ${TOKEN}`);
  assertEquals(result.length, 1);
  assertEquals(result[0].resource.labels.revision_name, "api-00002");
  assertEquals(result[0].points[0].value, {
    kind: "int64",
    value: 1,
    raw: "1",
  });
});

Deno.test("timeSeriesList follows nextPageToken to the last page", async () => {
  const fake = pages(
    { timeSeries: [series([1])], nextPageToken: "t1" },
    { timeSeries: [series([2])], nextPageToken: "t2" },
    { timeSeries: [series([3])] },
  );
  const result = await CloudMonitoringTasks.timeSeriesList((s) =>
    fiveXx(s, fake.fetch)
  );
  assertEquals(result.map((one) => one.points[0].value), [
    { kind: "int64", value: 1, raw: "1" },
    { kind: "int64", value: 2, raw: "2" },
    { kind: "int64", value: 3, raw: "3" },
  ]);
  assertEquals(fake.urls[0].searchParams.has("pageToken"), false);
  assertEquals(fake.urls[1].searchParams.get("pageToken"), "t1");
  assertEquals(fake.urls[2].searchParams.get("pageToken"), "t2");
});

Deno.test("timeSeriesList fails at the page cap rather than truncate", async () => {
  const fake = pages({ timeSeries: [series([1])], nextPageToken: "again" });
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        fiveXx(s, fake.fetch).maxPages(3)
      ),
    Error,
    "still had more pages after 3",
  );
  assertEquals(fake.urls.length, 3);
  // An empty token is the last page, as the API marks it.
  const last = pages({ timeSeries: [], nextPageToken: "" });
  assertEquals(
    await CloudMonitoringTasks.timeSeriesList((s) => fiveXx(s, last.fetch)),
    [],
  );
});

Deno.test("timeSeriesList: an empty body and an empty object are no series", async () => {
  assertEquals(
    await CloudMonitoringTasks.timeSeriesList((s) =>
      fiveXx(s, pages(new Response("")).fetch)
    ),
    [],
  );
  assertEquals(
    await CloudMonitoringTasks.timeSeriesList((s) =>
      fiveXx(s, pages({}).fetch)
    ),
    [],
  );
});

Deno.test("timeSeriesList parses every typed value proto3 JSON can carry", async () => {
  const fake = pages({
    timeSeries: [{
      metric: { type: "m" },
      points: [
        point(9, { doubleValue: 0.5 }),
        point(8, { doubleValue: "NaN" }),
        point(7, { doubleValue: "-Infinity" }),
        point(6, { int64Value: "9007199254740993" }),
        point(5, { int64Value: 4 }),
        point(4, { boolValue: false }),
        point(3, { stringValue: "up" }),
        point(2, { distributionValue: { count: "4", mean: 12.5 } }),
        point(1, { distributionValue: {} }),
        {
          interval: { endTime: "2026-10-07T12:00:00Z" },
          value: { int64Value: "0" },
        },
      ],
    }],
  });
  const [only] = await CloudMonitoringTasks.timeSeriesList((s) =>
    fiveXx(s, fake.fetch)
  );
  const values = only.points.map((p) => p.value);
  assertEquals(values[0], { kind: "double", value: 0.5 });
  assertEquals(
    Number.isNaN(values[1].kind === "double" ? values[1].value : 0),
    true,
  );
  assertEquals(values[2], { kind: "double", value: Number.NEGATIVE_INFINITY });
  // Beyond 2^53 the number rounds; the string it came as is kept exactly.
  assertEquals(values[3], {
    kind: "int64",
    value: 9007199254740992,
    raw: "9007199254740993",
  });
  assertEquals(values[4], { kind: "int64", value: 4, raw: "4" });
  assertEquals(values[5], { kind: "bool", value: false });
  assertEquals(values[6], { kind: "string", value: "up" });
  assertEquals(values[7], { kind: "distribution", count: 4, mean: 12.5 });
  assertEquals(values[8], { kind: "distribution", count: 0, mean: 0 });
  assertEquals(only.points[9].start, undefined);
  assertEquals(only.resource, { type: "", labels: {} });
  assertEquals(only.metric, { type: "m", labels: {} });
});

/** A page whose one series has `points`. */
function onePoint(value: unknown) {
  return {
    timeSeries: [{
      points: [{ interval: { endTime: "2026-10-07T12:00:00Z" }, value }],
    }],
  };
}

Deno.test("timeSeriesList refuses a shape it does not know, without quoting it", async () => {
  const cases: Array<[unknown, string]> = [
    ["aaaaaaaa", "a page that is not an object"],
    [{ timeSeries: ["aaaaaaaa"] }, "a series that is not an object"],
    [{ timeSeries: [{ points: ["x"] }] }, "a point with no interval"],
    [
      { timeSeries: [{ points: [{ interval: { endTime: "aaaaaaaa" } }] }] },
      "no readable end time",
    ],
    [onePoint("aaaaaaaa"), "a point with no value"],
    [onePoint({}), "no type it documents"],
    [onePoint({ int64Value: "1.5e3" }), "not an integer"],
    [onePoint({ doubleValue: "aaaaaaaa" }), "not a number"],
    [onePoint({ distributionValue: { count: "x" } }), "not an integer"],
    [
      { timeSeries: [{ metric: { labels: "aaaaaaaa" } }] },
      "labels that are not a map",
    ],
    [
      { timeSeries: [{ resource: { labels: { a: 1 } } }] },
      "a label that is not a string",
    ],
  ];
  for (const [body, message] of cases) {
    const error = await assertRejects(
      () =>
        CloudMonitoringTasks.timeSeriesList((s) =>
          fiveXx(s, pages(body).fetch)
        ),
      Error,
      message,
    );
    assertEquals(error.message.includes("aaaaaaaa"), false, message);
  }
});

Deno.test("timeSeriesList refuses a partial answer the API flagged", async () => {
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        fiveXx(
          s,
          pages({ timeSeries: [series([1])], executionErrors: [{ code: 3 }] })
            .fetch,
        )
      ),
    Error,
    "1 execution error(s)",
  );
});

Deno.test("an auth failure is an HttpError that never carries the token", async () => {
  const fake = pages(new Response('{"error":{"code":401}}', { status: 401 }));
  const error = await assertRejects(
    () => CloudMonitoringTasks.timeSeriesList((s) => fiveXx(s, fake.fetch)),
    HttpError,
  );
  assertEquals(error instanceof HttpError && error.status, 401);
  assertEquals(error.message.includes(TOKEN), false);
  assertEquals(String(error.stack).includes(TOKEN), false);
});

Deno.test("the default token comes from gcloud, through the .gcloud(...) lambda's instance", async () => {
  const calls: string[][] = [];
  const runner = (settings: GcloudSettings) => {
    calls.push(settings.argv());
    return Promise.resolve(new CommandOutput(0, "bbbbbbbb\n", ""));
  };
  const fake = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    s.project("p").metricType("m").fetch(fake.fetch).now(NOW)
      .gcloud((g) => g.account("ci@p.iam.gserviceaccount.com").runner(runner))
  );
  assertEquals(calls[0].slice(1, 3), ["auth", "print-access-token"]);
  assertEquals(calls[0].includes("ci@p.iam.gserviceaccount.com"), true);
  assertEquals(fake.headers[0].get("authorization"), "Bearer bbbbbbbb");
  // A provider is used when no token is set.
  const provided = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    s.project("p").metricType("m").fetch(provided.fetch)
      .tokenProvider(() => Promise.resolve("cccccccc"))
  );
  assertEquals(provided.headers[0].get("authorization"), "Bearer cccccccc");
});

Deno.test("the project comes from the environment when not named", async () => {
  const fake = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    s.metricType("m").token(TOKEN).fetch(fake.fetch)
      .readEnv((name) => name === "GCLOUD_PROJECT" ? "env-proj" : undefined)
  );
  assertStringIncludes(fake.urls[0].pathname, "/projects/env-proj/");
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.metricType("m").token(TOKEN).fetch(fake.fetch).readEnv(() => "")
      ),
    Error,
    "CloudMonitoringTasks.timeSeriesList: no project — add .project(id)",
  );
});

Deno.test("the filter: raw parts are parenthesised, and a metric must be named", async () => {
  const fake = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    s.project("p").token(TOKEN).fetch(fake.fetch)
      .filter('metric.type = starts_with("custom.googleapis.com/")')
  );
  assertEquals(
    fake.urls[0].searchParams.get("filter"),
    '(metric.type = starts_with("custom.googleapis.com/"))',
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").token(TOKEN).fetch(fake.fetch)
      ),
    Error,
    "no metric named",
  );
});

Deno.test("the filter refuses what the Monitoring language cannot escape", async () => {
  const fake = pages({});
  type Refused = [
    (s: CloudMonitoringTimeSeriesSettings) => CloudMonitoringTimeSeriesSettings,
    string,
  ];
  const cases: Refused[] = [
    [
      (s) => s.resourceLabel("revision_name", 'x" OR metric.type = "y'),
      "quotation mark",
    ],
    [(s) => s.metricLabel("k", "a\\b"), "backslash"],
    [(s) => s.resourceType("a\u0000"), "control character"],
    [(s) => s.metricLabel("k-1", "v"), "not a label key"],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      () =>
        CloudMonitoringTasks.timeSeriesList((s) =>
          configure(
            s.project("p").metricType("m").token(TOKEN).fetch(fake.fetch),
          )
        ),
      Error,
      message,
    );
  }
  assertEquals(fake.urls.length, 0);
});

Deno.test("aggregation is refused where the API would refuse it", async () => {
  const base = (s: CloudMonitoringTimeSeriesSettings) =>
    s.project("p").metricType("m").token(TOKEN).fetch(pages({}).fetch);
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s).perSeriesAligner("ALIGN_RATE")
      ),
    Error,
    "needs an alignment period",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s).alignmentPeriod("1m").crossSeriesReducer("REDUCE_SUM")
      ),
    Error,
    "per-series aligner other than ALIGN_NONE",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s).alignmentPeriod("1m").perSeriesAligner("ALIGN_NONE")
          .crossSeriesReducer("REDUCE_MAX")
      ),
    Error,
    "per-series aligner other than ALIGN_NONE",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) => base(s).groupByFields("x")),
    Error,
    "only applies with a cross-series reducer",
  );
  // ALIGN_NONE and REDUCE_NONE need nothing.
  assertEquals(
    await CloudMonitoringTasks.timeSeriesList((s) =>
      base(s).perSeriesAligner("ALIGN_NONE").crossSeriesReducer("REDUCE_NONE")
    ),
    [],
  );
});

Deno.test("setters refuse values the API cannot take", () => {
  const s = new CloudMonitoringTimeSeriesSettings();
  assertThrows(() => s.alignmentPeriod("30s"), Error, "at least 60");
  assertThrows(() => s.alignmentPeriod(60_500), Error, "whole seconds");
  assertThrows(() => s.window(0), Error, "longer than zero");
  assertThrows(() => s.pageSize(0), Error, ".pageSize(0) is not a count");
  assertThrows(() => s.maxPages(1.5), Error, ".maxPages(1.5) is not a count");
  assertThrows(
    () => new CloudMonitoringMetricValueSettings().missingDataAs(Number.NaN),
    Error,
    "needs a finite number",
  );
});

Deno.test("the interval: explicit, unaligned, aligned, and refused", async () => {
  const fake = pages({});
  const base = (s: CloudMonitoringTimeSeriesSettings) =>
    s.project("p").metricType("m").token(TOKEN).fetch(fake.fetch).now(NOW);
  const start = new Date(Date.UTC(2026, 9, 7, 11));
  const end = new Date(Date.UTC(2026, 9, 7, 12));
  await CloudMonitoringTasks.timeSeriesList((s) =>
    base(s).interval(start, end)
  );
  assertEquals(
    fake.urls[0].searchParams.get("interval.startTime"),
    start.toISOString(),
  );
  // No alignment period: the window ends now.
  await CloudMonitoringTasks.timeSeriesList((s) => base(s).window("1m"));
  assertEquals(
    fake.urls[1].searchParams.get("interval.endTime"),
    "2026-10-07T12:10:30.000Z",
  );
  assertEquals(
    fake.urls[1].searchParams.get("interval.startTime"),
    "2026-10-07T12:09:30.000Z",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) => base(s).interval(end, start)),
    Error,
    "starts after it ends",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s).alignmentPeriod("5m").window("2m")
      ),
    Error,
    "shorter than the alignment period",
  );
});

Deno.test("metricValue: latest sums the series at the newest time", async () => {
  const body = {
    timeSeries: [
      series([2, 7], 10, "a"),
      series([3], 10, "b"),
      series([5], 9, "c"),
    ],
  };
  const read = (how?: "latest" | "sum" | "average" | "maximum" | "minimum") =>
    CloudMonitoringTasks.metricValue((s) => {
      const configured = fiveXx(s, pages(body).fetch).view("HEADERS");
      return how === undefined ? configured : configured.aggregate(how);
    });
  assertEquals(await read(), 5);
  assertEquals(await read("sum"), 17);
  assertEquals(await read("average"), 17 / 4);
  assertEquals(await read("maximum"), 7);
  assertEquals(await read("minimum"), 2);
});

Deno.test("metricValue pins the FULL view after the caller's lambda", async () => {
  const fake = pages({ timeSeries: [series([1])] });
  await CloudMonitoringTasks.metricValue((s) =>
    fiveXx(s, fake.fetch).view("HEADERS")
  );
  assertEquals(fake.urls[0].searchParams.get("view"), "FULL");
});

Deno.test("metricValue: no points fails unless missingDataAs says what it means", async () => {
  await assertRejects(
    () => CloudMonitoringTasks.metricValue((s) => fiveXx(s, pages({}).fetch)),
    Error,
    "returned no points",
  );
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) =>
      fiveXx(s, pages({}).fetch).missingDataAs(0)
    ),
    0,
  );
});

Deno.test("metricValue: a distribution reads as its mean; bool, string and NaN are refused", async () => {
  const one = (value: unknown) =>
    CloudMonitoringTasks.metricValue((s) =>
      fiveXx(s, pages(onePoint(value)).fetch)
    );
  assertEquals(
    await one({ distributionValue: { count: "2", mean: 120 } }),
    120,
  );
  assertEquals(await one({ doubleValue: 0.25 }), 0.25);
  await assertRejects(
    () => one({ boolValue: true }),
    Error,
    "ALIGN_FRACTION_TRUE",
  );
  await assertRejects(() => one({ stringValue: "up" }), Error, "is a STRING");
  await assertRejects(() => one({ doubleValue: "NaN" }), Error, "(NaN)");
});

Deno.test("metricValue folds a long series without overflowing the stack", async () => {
  const values = Array.from({ length: 200_000 }, (_, i) => i % 7);
  const big = {
    timeSeries: [{
      points: values.map((v) => ({
        interval: { endTime: "2026-10-07T12:00:00Z" },
        value: { int64Value: String(v) },
      })),
    }],
  };
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) =>
      fiveXx(s, pages(big).fetch).aggregate("maximum")
    ),
    6,
  );
});

Deno.test("both tasks run without a lambda, and refuse for want of a metric", async () => {
  await assertRejects(
    () => CloudMonitoringTasks.timeSeriesList(),
    Error,
    "CloudMonitoringTasks.timeSeriesList: no metric named",
  );
  await assertRejects(
    () => CloudMonitoringTasks.metricValue(),
    Error,
    "CloudMonitoringTasks.metricValue: no metric named",
  );
});

Deno.test("minimum and maximum find their value wherever it sits", async () => {
  const body = { timeSeries: [series([4, 1, 9, 3])] };
  const read = (how: "maximum" | "minimum") =>
    CloudMonitoringTasks.metricValue((s) =>
      fiveXx(s, pages(body).fetch).aggregate(how)
    );
  assertEquals(await read("minimum"), 1);
  assertEquals(await read("maximum"), 9);
});

Deno.test("a series' unit is kept, and a non-string end time is refused", async () => {
  const [one] = await CloudMonitoringTasks.timeSeriesList((s) =>
    fiveXx(s, pages({ timeSeries: [{ ...series([1]), unit: "1" }] }).fetch)
  );
  assertEquals(one.unit, "1");
  assertEquals(one.metricKind, "DELTA");
  assertEquals(one.valueType, "INT64");
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        fiveXx(
          s,
          pages({
            timeSeries: [{
              points: [{
                interval: { endTime: 5 },
                value: { int64Value: "1" },
              }],
            }],
          }).fetch,
        )
      ),
    Error,
    "no readable end time",
  );
});
