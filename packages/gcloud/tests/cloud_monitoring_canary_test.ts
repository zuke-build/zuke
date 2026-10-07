// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import {
  cloudMonitoring,
  CloudMonitoringAnalysisSettings,
  type GcloudSettings,
} from "../mod.ts";
import { NOW, pages, series, TOKEN } from "./_monitoring.ts";

/** A context whose redactor masks nothing. */
const plain = { redact: (text: string) => text };

/** A context whose redactor masks `secret`. */
function masking(secret: string) {
  return { redact: (text: string) => text.replaceAll(secret, "***") };
}

/** The 5xx count of a candidate revision, answered by `fetch`. */
function analysis(
  fetch: typeof globalThis.fetch,
  extra: (
    m: CloudMonitoringAnalysisSettings,
  ) => CloudMonitoringAnalysisSettings = (m) => m,
) {
  return cloudMonitoring((m) =>
    extra(
      m.name("canary 5xx").project("p").token(TOKEN).fetch(fetch).now(NOW)
        .metricType("run.googleapis.com/request_count")
        .resourceType("cloud_run_revision")
        .resourceLabel("revision_name", "api-00002")
        .metricLabel("response_code_class", "5xx")
        .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
        .crossSeriesReducer("REDUCE_SUM").window("5m").max(5),
    )
  );
}

Deno.test("cloudMonitoring has the canary analysis shape", () => {
  assertEquals(analysis(pages({}).fetch).name, "cloudMonitoring");
});

Deno.test("cloudMonitoring passes when every point is within bounds", async () => {
  const fake = pages({ timeSeries: [series([0, 5, 1])] });
  await analysis(fake.fetch).validate(plain);
  assertEquals(fake.urls[0].searchParams.get("view"), "FULL");
  assertEquals(
    fake.urls[0].searchParams.get("interval.endTime"),
    "2026-10-07T12:10:00.000Z",
  );
});

Deno.test("cloudMonitoring fails on the first point out of bounds, in canary's words", async () => {
  const fake = pages({ timeSeries: [series([0, 9, 1])] });
  await assertRejects(
    () => analysis(fake.fetch).validate(plain),
    Error,
    "canary 5xx at 2026-10-07T12:09:00.000Z is 9, above the maximum 5.",
  );
  await assertRejects(
    () =>
      analysis(pages({ timeSeries: [series([1])] }).fetch, (m) => m.min(2))
        .validate(plain),
    Error,
    "is 1, below the minimum 2.",
  );
});

Deno.test("cloudMonitoring: no data fails unless missingDataAs says what it means", async () => {
  await assertRejects(
    () => analysis(pages({}).fetch).validate(plain),
    Error,
    "canary 5xx has no data in the last 300000 ms",
  );
  await analysis(pages({}).fetch, (m) => m.missingDataAs(0)).validate(plain);
  await assertRejects(
    () => analysis(pages({}).fetch, (m) => m.missingDataAs(9)).validate(plain),
    Error,
    "canary 5xx (no data) is 9, above the maximum 5.",
  );
});

Deno.test("cloudMonitoring refuses a window shorter than the alignment period", async () => {
  const fake = pages({});
  await assertRejects(
    () => analysis(fake.fetch, (m) => m.alignmentPeriod("10m")).validate(plain),
    Error,
    "canary 5xx could not be read: cloudMonitoring: the window of 300000 ms " +
      "is shorter than the alignment period",
  );
  assertEquals(fake.urls.length, 0);
});

Deno.test("cloudMonitoring fails, never truncates, at the page cap", async () => {
  await assertRejects(
    () =>
      analysis(
        pages({ timeSeries: [series([0])], nextPageToken: "more" }).fetch,
        (m) => m.maxPages(2),
      ).validate(plain),
    Error,
    "still had more pages after 2",
  );
});

Deno.test("cloudMonitoring judges a NaN point as a failure", async () => {
  const nan = {
    timeSeries: [{
      points: [{
        interval: { endTime: "2026-10-07T12:09:00Z" },
        value: { doubleValue: "NaN" },
      }],
    }],
  };
  await assertRejects(
    () => analysis(pages(nan).fetch).validate(plain),
    Error,
    "is not a number (NaN).",
  );
});

Deno.test("cloudMonitoring refuses bounds that cannot work", async () => {
  await assertRejects(
    () => cloudMonitoring((m) => m.metricType("m")).validate(plain),
    Error,
    '"m" sets no bound',
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) => m.metricType("m").min(5).max(1)).validate(plain),
    Error,
    "can never pass",
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) => m.max(Number.POSITIVE_INFINITY)).validate(plain),
    Error,
    "max needs a finite number",
  );
  await assertRejects(
    () => cloudMonitoring((m) => m.min(Number.NaN)).validate(plain),
    Error,
    "min needs a finite number",
  );
  await assertRejects(
    () => cloudMonitoring((m) => m.max(1)).validate(plain),
    Error,
    "cloud monitoring metric could not be read: cloudMonitoring: no metric named",
  );
});

Deno.test("every failure passes through the redactor, the lambda's own included", async () => {
  const secret = "dddddddd";
  await assertRejects(
    () =>
      cloudMonitoring(() => {
        throw new Error(`lambda saw ${secret}`);
      }).validate(masking(secret)),
    Error,
    "lambda saw ***",
  );
  const leaky = pages(new Response("", { status: 403 }));
  const error = await assertRejects(
    () =>
      analysis(leaky.fetch, (m) => m.resourceLabel("service_name", secret))
        .validate(masking(secret)),
    Error,
    "HTTP 403",
  );
  assertEquals(error.message.includes(secret), false);
  const breach = await assertRejects(
    () =>
      analysis(
        pages({ timeSeries: [series([9])] }).fetch,
        (m) => m.name(`5xx of ${secret}`),
      ).validate(masking(secret)),
    Error,
    "5xx of *** at",
  );
  assertEquals(breach.message.includes(secret), false);
  const empty = await assertRejects(
    () =>
      analysis(pages({}).fetch, (m) => m.name(secret)).validate(
        masking(secret),
      ),
    Error,
    "*** has no data",
  );
  assertEquals(empty.message.includes(secret), false);
});

Deno.test("the instance the lambda returns is the one read", async () => {
  const fake = pages({ timeSeries: [series([0])] });
  // A lambda that ignores the instance it is handed and returns another.
  await cloudMonitoring(() =>
    new CloudMonitoringAnalysisSettings().project("p").token(TOKEN)
      .fetch(fake.fetch).now(NOW).metricType("m")
      .resourceLabel("revision_name", "api-00009").max(5)
  ).validate(plain);
  assertStringIncludes(
    fake.urls[0].searchParams.get("filter") ?? "",
    "api-00009",
  );
});

/** A runner answering a log read with `n` entries, recording the argv. */
function logs(n: number) {
  const calls: string[][] = [];
  const run = (settings: GcloudSettings) => {
    calls.push(settings.argv());
    const ids = Array.from({ length: n }, (_, i) => ({ insertId: `i${i}` }));
    return Promise.resolve(new CommandOutput(0, JSON.stringify(ids), ""));
  };
  return { calls, run };
}

Deno.test("log mode counts entries over the window, ids only", async () => {
  const fake = logs(2);
  await cloudMonitoring((m) =>
    m.name("canary errors").project("p").now(NOW).window("10m").max(3)
      .logEntries((l) =>
        l.resourceType("cloud_run_revision")
          .resourceLabel("revision_name", "api-00002").minSeverity("ERROR")
          .limit(50)
      )
      .gcloud((g) => g.runner(fake.run))
  ).validate(plain);
  const argv = fake.calls[0];
  assertEquals(argv.slice(1, 3), ["logging", "read"]);
  assertEquals(
    argv[3],
    'resource.type="cloud_run_revision" AND ' +
      'resource.labels.revision_name="api-00002" AND severity>=ERROR AND ' +
      'timestamp>="2026-10-07T12:00:30.000Z" AND ' +
      'timestamp<"2026-10-07T12:10:30.000Z"',
  );
  assertEquals(argv.includes("--limit=51"), true);
  assertEquals(argv.slice(-4), [
    "--project",
    "p",
    "--format",
    "json(insertId)",
  ]);
});

Deno.test("log mode fails over the bound and when more entries match than it counts", async () => {
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.now(NOW).max(1).logEntries((l) => l.minSeverity("ERROR"))
          .gcloud((g) => g.runner(logs(4).run))
      ).validate(plain),
    Error,
    "log entries is 4, above the maximum 1.",
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.now(NOW).max(100).logEntries((l) => l.limit(3))
          .gcloud((g) => g.runner(logs(4).run))
      ).validate(plain),
    Error,
    "log entries could not be read: cloudMonitoring: more than 3 log entries",
  );
});

Deno.test("log mode: zero entries is a count, judged as itself", async () => {
  await cloudMonitoring((m) =>
    m.now(NOW).min(0).max(0).logEntries((l) => l)
      .gcloud((g) => g.runner(logs(0).run))
  ).validate(plain);
});

Deno.test("a metric and log entries together are refused", async () => {
  await assertRejects(
    () =>
      cloudMonitoring((m) => m.metricType("m").max(1).logEntries((l) => l))
        .validate(plain),
    Error,
    "not both",
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) => m.filter("x").max(1).logEntries((l) => l))
        .validate(plain),
    Error,
    "not both",
  );
  for (
    const narrow of [
      (m: CloudMonitoringAnalysisSettings) => m.resourceType("t"),
      (m: CloudMonitoringAnalysisSettings) => m.resourceLabel("k", "v"),
      (m: CloudMonitoringAnalysisSettings) => m.metricLabel("k", "v"),
    ]
  ) {
    await assertRejects(
      () =>
        cloudMonitoring((m) => narrow(m).max(1).logEntries((l) => l))
          .validate(plain),
      Error,
      "would not narrow the log read",
    );
  }
});

Deno.test("a lambda that throws a non-Error is still redacted and reported", async () => {
  await assertRejects(
    () =>
      cloudMonitoring(() => {
        throw "iiiiiiii went wrong";
      }).validate(masking("iiiiiiii")),
    Error,
    "*** went wrong",
  );
});

Deno.test("a minimum alone is a bound", async () => {
  const fetch = pages({ timeSeries: [series([3])] }).fetch;
  await cloudMonitoring((m) =>
    m.project("p").token(TOKEN).fetch(fetch).now(NOW).metricType("m").min(1)
  ).validate(plain);
});

/** A runner answering a revision read with `revision` and a log read with ids. */
function cloudRun(revision: string, code = 0) {
  const calls: string[][] = [];
  const run = (settings: GcloudSettings) => {
    const argv = settings.argv();
    calls.push(argv);
    const stdout = argv.includes("describe") ? `${revision}\n` : "[]";
    return Promise.resolve(new CommandOutput(code, stdout, "boom"));
  };
  return { calls, run };
}

Deno.test("cloudRunCandidate narrows the metric to the latest created revision", async () => {
  const gcloud = cloudRun("api-00007-abc");
  const fake = pages({ timeSeries: [series([1])] });
  // One instance, configured once and returned by every run of the lambda.
  const configured = new CloudMonitoringAnalysisSettings()
    .name("canary 5xx").project("p").token(TOKEN).fetch(fake.fetch)
    .now(NOW).metricType("run.googleapis.com/request_count")
    .resourceType("cloud_run_revision")
    .cloudRunCandidate("api", "europe-west1")
    .metricLabel("response_code_class", "5xx").max(5)
    .gcloud((g) => g.project("p").runner(gcloud.run));
  const check = cloudMonitoring(() => configured);
  await check.validate(plain);
  // The same instance, read twice, is narrowed once each time.
  await check.validate(plain);
  assertEquals(gcloud.calls[0].slice(1, 5), [
    "run",
    "services",
    "describe",
    "api",
  ]);
  assertEquals(gcloud.calls[0].includes("--region"), true);
  assertEquals(
    gcloud.calls[0].includes("value(status.latestCreatedRevisionName)"),
    true,
  );
  for (const url of fake.urls) {
    assertEquals(
      url.searchParams.get("filter"),
      'metric.type = "run.googleapis.com/request_count" AND ' +
        'resource.type = "cloud_run_revision" AND ' +
        'resource.labels.service_name = "api" AND ' +
        'resource.labels.revision_name = "api-00007-abc" AND ' +
        'metric.labels.response_code_class = "5xx"',
    );
  }
});

Deno.test("cloudRunCandidate narrows the log filter too", async () => {
  const gcloud = cloudRun("api-00007-abc");
  await cloudMonitoring((m) =>
    m.now(NOW).max(0).cloudRunCandidate("api")
      .logEntries((l) => l.resourceType("cloud_run_revision"))
      .gcloud((g) => g.runner(gcloud.run))
  ).validate(plain);
  assertEquals(gcloud.calls[0].includes("--region"), false);
  assertStringIncludes(
    gcloud.calls[1][3],
    'resource.labels.service_name="api" AND ' +
      'resource.labels.revision_name="api-00007-abc"',
  );
});

Deno.test("cloudRunCandidate: a failed or ambiguous read fails the check", async () => {
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.project("p").token(TOKEN).metricType("m").max(1)
          .cloudRunCandidate("api")
          .gcloud((g) => g.noThrow().runner(cloudRun("x", 1).run))
      ).validate(plain),
    Error,
    "could not be read",
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.project("p").token(TOKEN).metricType("m").max(1)
          .cloudRunCandidate("api")
          .gcloud((g) => g.runner(cloudRun("a\nb").run))
      ).validate(plain),
    Error,
    "more than one line",
  );
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.project("p").token(TOKEN).metricType("m").max(1)
          .cloudRunCandidate("--project=other")
          .gcloud((g) => g.runner(cloudRun("x").run))
      ).validate(plain),
    Error,
    "starts with '-'",
  );
});
