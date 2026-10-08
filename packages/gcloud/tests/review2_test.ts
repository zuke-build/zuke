// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the second adversarial review of the Cloud Logging and
 * Cloud Monitoring additions. Each names the finding it guards (H = wrong
 * numbers, M = medium, L = low, R = repo rules), and each failed against the
 * code before its fix. Where a refusal must fire before anything runs, the
 * runner or `fetch` ignores what it is handed and would answer "success".
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  cloudMonitoring,
  CloudMonitoringTasks,
  type CloudMonitoringTimeSeriesSettings,
  cloudRunCanary,
  GcloudLoggingReadSettings,
  GcloudOutputError,
  type GcloudSettings,
  GcloudTasks,
} from "../mod.ts";
import { NOW, pages, point, series, TOKEN } from "./_monitoring.ts";

/** A context whose redactor masks nothing. */
const plain = { redact: (text: string) => text };

/** A runner that records argv and answers every command with `stdout`. */
function recording(stdout: string, code = 0) {
  const calls: string[][] = [];
  const run = (settings: GcloudSettings) => {
    calls.push(settings.argv());
    return Promise.resolve(new CommandOutput(code, stdout, ""));
  };
  return { calls, run };
}

/** A `fetch` that counts calls and answers an empty page, ignoring the request. */
function ignoringFetch() {
  const state = { calls: 0 };
  const fetch: typeof globalThis.fetch = () => {
    state.calls++;
    return Promise.resolve(new Response("{}"));
  };
  return { fetch, state };
}

/** A read with the shared fakes, for the aggregate tests. */
function base<S extends CloudMonitoringTimeSeriesSettings>(
  s: S,
  fetch: typeof globalThis.fetch,
): S {
  return s.project("p").token(TOKEN).fetch(fetch).now(NOW).metricType("m");
}

/** A distribution point at `minute` with `count` samples of mean `mean`. */
function dist(minute: number, count: number, mean: number) {
  return point(minute, {
    distributionValue: { count: String(count), mean },
  });
}

// H1 ------------------------------------------------------------------------

Deno.test("H1: the candidate lookup runs in the analysis's project, and the lambda may override it", async () => {
  const gcloud = recording("api-00002\n");
  const fake = pages({ timeSeries: [series([0])] });
  await cloudMonitoring((m) =>
    m.project("p").token(TOKEN).fetch(fake.fetch).now(NOW)
      .metricType("run.googleapis.com/request_count")
      .resourceType("cloud_run_revision")
      .cloudRunCandidate("api", "europe-west1").max(5)
      .gcloud((g) => g.runner(gcloud.run))
  ).validate(plain);
  const describe = gcloud.calls[0];
  assertEquals(describe[describe.indexOf("--project") + 1], "p");
  assertStringIncludes(
    fake.urls[0].searchParams.get("filter") ?? "",
    'resource.labels.location = "europe-west1"',
  );
  const overridden = recording("api-00002\n");
  await cloudMonitoring((m) =>
    m.project("p").token(TOKEN).fetch(pages({}).fetch).now(NOW)
      .metricType("m").cloudRunCandidate("api").max(5).missingDataAs(0)
      .gcloud((g) => g.project("q").runner(overridden.run))
  ).validate(plain);
  const argv = overridden.calls[0];
  assertEquals(argv.filter((t) => t === "--project").length, 1);
  assertEquals(argv[argv.indexOf("--project") + 1], "q");
});

// H2 ------------------------------------------------------------------------

Deno.test("H2: an average of distributions is weighted by their counts", async () => {
  const body = {
    timeSeries: [
      { valueType: "DISTRIBUTION", points: [dist(10, 1000, 100)] },
      { valueType: "DISTRIBUTION", points: [dist(10, 1, 5000)] },
    ],
  };
  const average = await CloudMonitoringTasks.metricValue((s) =>
    base(s, pages(body).fetch).aggregate("average")
  );
  assertEquals(average, (1000 * 100 + 5000) / 1001);
});

Deno.test("H2: latest and sum refuse to add distribution means together", async () => {
  const body = {
    timeSeries: [
      { valueType: "DISTRIBUTION", points: [dist(10, 5, 100)] },
      { valueType: "DISTRIBUTION", points: [dist(10, 5, 110)] },
      { valueType: "DISTRIBUTION", points: [dist(10, 5, 100)] },
    ],
  };
  await assertRejects(
    () => CloudMonitoringTasks.metricValue((s) => base(s, pages(body).fetch)),
    Error,
    "crossSeriesReducer",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.metricValue((s) =>
        base(s, pages({ timeSeries: [body.timeSeries[0]] }).fetch)
          .aggregate("sum")
      ),
    Error,
    "DISTRIBUTION",
  );
  // One distribution series: latest is its newest mean.
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) =>
      base(s, pages({ timeSeries: [body.timeSeries[1]] }).fetch)
    ),
    110,
  );
});

// H3 ------------------------------------------------------------------------

Deno.test("H3: latest sums each series' own newest point", async () => {
  const gauge = (minute: number, value: number) => ({
    metricKind: "GAUGE",
    points: [point(minute, { doubleValue: value })],
  });
  const body = { timeSeries: [gauge(10, 5), gauge(9, 4), gauge(8, 3)] };
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) => base(s, pages(body).fetch)),
    12,
  );
});

// H4 ------------------------------------------------------------------------

Deno.test("H4: an unaligned CUMULATIVE series is refused, with the aligner to add", async () => {
  const running = {
    timeSeries: [{
      metricKind: "CUMULATIVE",
      points: [1000, 990, 980].map((v, i) =>
        point(10 - i, { int64Value: String(v) })
      ),
    }],
  };
  for (const how of ["sum", "average", "latest", "maximum"] as const) {
    await assertRejects(
      () =>
        CloudMonitoringTasks.metricValue((s) =>
          base(s, pages(running).fetch).aggregate(how)
        ),
      Error,
      "ALIGN_DELTA",
    );
  }
  await assertRejects(
    () =>
      cloudMonitoring((m) => base(m, pages(running).fetch).max(5000))
        .validate(plain),
    Error,
    "ALIGN_DELTA",
  );
  // With a delta aligner set, the API has turned it into increases.
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) =>
      base(s, pages(running).fetch).alignmentPeriod("60s")
        .perSeriesAligner("ALIGN_DELTA").window("5m").aggregate("sum")
    ),
    2970,
  );
});

// H5 ------------------------------------------------------------------------

Deno.test("H5: freshness is an explicit timestamp bound, never left to gcloud", () => {
  const argv = new GcloudLoggingReadSettings().filter("jsonPayload.timestamp:x")
    .freshness("10m").order("asc").argv();
  assertStringIncludes(argv[3], 'timestamp>="');
  assertEquals(argv.some((t) => t.startsWith("--freshness")), false);
});

Deno.test("H5: a log count always has a lower time bound", async () => {
  const gcloud = recording("[]");
  await GcloudTasks.logEntryCount((s) =>
    s.filter("jsonPayload.timestamp:x").runner(gcloud.run)
  );
  assertStringIncludes(gcloud.calls[0][3], 'timestamp>="');
});

// H6 ------------------------------------------------------------------------

Deno.test("H6: the canary's window ends two minutes back, for the ingestion delay", async () => {
  const fake = pages({ timeSeries: [series([0])] });
  await cloudMonitoring((m) =>
    base(m, fake.fetch).alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
      .window("5m").max(5)
  ).validate(plain);
  // 12:10:30 less two minutes is 12:08:30, aligned down to 12:08.
  assertEquals(
    fake.urls[0].searchParams.get("interval.endTime"),
    "2026-10-07T12:08:00.000Z",
  );
});

// M1 ------------------------------------------------------------------------

Deno.test("M1: an aborted check stops before reading", async () => {
  const fetch = ignoringFetch();
  const controller = new AbortController();
  controller.abort();
  const context = { redact: plain.redact, signal: controller.signal };
  await assertRejects(
    () =>
      cloudMonitoring((m) => base(m, fetch.fetch).max(5).missingDataAs(0))
        .validate(context),
  );
  assertEquals(fetch.state.calls, 0);
});

Deno.test("M1: the signal reaches the request", async () => {
  const seen: Array<AbortSignal | null | undefined> = [];
  const fetch: typeof globalThis.fetch = (_input, init) => {
    seen.push(init?.signal);
    return Promise.resolve(new Response("{}"));
  };
  const controller = new AbortController();
  const context = { redact: plain.redact, signal: controller.signal };
  await cloudMonitoring((m) => base(m, fetch).max(5).missingDataAs(0))
    .validate(context);
  assertEquals(seen[0] === controller.signal, true);
});

// M2 ------------------------------------------------------------------------

Deno.test("M2: the count reader refuses a caller's own --limit or --format", async () => {
  const extras: Array<<S extends GcloudSettings>(s: S) => S> = [
    (s) => s.flag("limit", "1"),
    (s) => s.flag("format", "json"),
    (s) => s.args("--limit=1"),
    (s) => s.args("--format=json"),
    (s) => s.flag("flags-file", "f.yaml"),
  ];
  for (const add of extras) {
    const gcloud = recording("[]");
    await assertRejects(
      () => GcloudTasks.logEntryCount((s) => add(s).runner(gcloud.run)),
      Error,
      "pins",
    );
    assertEquals(gcloud.calls.length, 0);
  }
});

// L1 ------------------------------------------------------------------------

Deno.test("L1: a NaN point is refused wherever it sits", async () => {
  const body = {
    timeSeries: [{
      points: [
        point(10, { doubleValue: 1 }),
        point(9, { doubleValue: "NaN" }),
      ],
    }],
  };
  for (const how of ["maximum", "minimum", "latest"] as const) {
    await assertRejects(
      () =>
        CloudMonitoringTasks.metricValue((s) =>
          base(s, pages(body).fetch).aggregate(how)
        ),
      Error,
      "NaN",
    );
  }
});

// L2 ------------------------------------------------------------------------

Deno.test("L2: a failed token command is an error, even after noThrow", async () => {
  const fetch = ignoringFetch();
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        s.project("p").metricType("m").fetch(fetch.fetch)
          .gcloud((g) => g.noThrow().runner(recording("", 1).run))
      ),
    CommandError,
  );
  assertEquals(fetch.state.calls, 0);
});

Deno.test("L2: an empty token, or one ending in a control character, is refused", async () => {
  const fetch = ignoringFetch();
  for (const token of ["", "  \n", "aaaaaaaa\v", "\faaaaaaaa"]) {
    const error = await assertRejects(
      () =>
        CloudMonitoringTasks.timeSeriesList((s) =>
          s.project("p").metricType("m").token(token).fetch(fetch.fetch)
        ),
      Error,
    );
    assertEquals(error.message.includes("aaaaaaaa"), false);
  }
  assertEquals(fetch.state.calls, 0);
});

// L3 ------------------------------------------------------------------------

Deno.test("L3: a body that is not JSON is refused without quoting it", async () => {
  const error = await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s, pages(new Response("aaaaaaaa-not-json")).fetch)
      ),
    Error,
  );
  assertEquals(error.message.includes("aaaaaaaa"), false);
});

// L4 ------------------------------------------------------------------------

Deno.test("L4: log mode refuses settings only a metric read uses", async () => {
  const metricOnly: Array<
    (m: CloudMonitoringTimeSeriesSettings) => CloudMonitoringTimeSeriesSettings
  > = [
    (m) => m.perSeriesAligner("ALIGN_SUM"),
    (m) => m.crossSeriesReducer("REDUCE_SUM"),
    (m) => m.groupByFields("x"),
    (m) => m.token(TOKEN),
    (m) => m.fetch(ignoringFetch().fetch),
    (m) => m.maxPages(2),
    (m) => m.pageSize(2),
    (m) => m.readEnv(() => undefined),
    (m) => m.tokenProvider(() => Promise.resolve(TOKEN)),
  ];
  for (const set of metricOnly) {
    const gcloud = recording("[]");
    await assertRejects(
      () =>
        cloudMonitoring((m) => {
          set(m);
          return m.now(NOW).max(1).logEntries((l) => l)
            .gcloud((g) => g.runner(gcloud.run));
        }).validate(plain),
      Error,
      "log",
    );
    assertEquals(gcloud.calls.length, 0);
  }
});

// L5 ------------------------------------------------------------------------

Deno.test("L5: the no-data message names the interval actually read", async () => {
  const start = new Date(Date.UTC(2026, 9, 7, 9));
  const end = new Date(Date.UTC(2026, 9, 7, 10));
  await assertRejects(
    () =>
      cloudMonitoring((m) =>
        base(m, pages({}).fetch).interval(start, end).max(1)
      ).validate(plain),
    Error,
    "between 2026-10-07T09:00:00.000Z and 2026-10-07T10:00:00.000Z",
  );
});

// L6 ------------------------------------------------------------------------

Deno.test("L6: minSeverity refuses a value that is not a severity", () => {
  assertThrows(
    () =>
      // @ts-expect-error: a JavaScript caller can pass any string; the
      // runtime guard is what keeps it out of the filter.
      new GcloudLoggingReadSettings().minSeverity("ERROR OR true"),
    Error,
    "not a Cloud Logging severity",
  );
});

// L7 ------------------------------------------------------------------------

Deno.test("L7: a list whose first value starts with '^' is refused", () => {
  assertThrows(
    () =>
      new GcloudLoggingReadSettings().resourceNames("^;^projects/a;projects/b")
        .argv(),
    Error,
    "'^'",
  );
});

// L8 ------------------------------------------------------------------------

Deno.test("L8: a project that is not a project id is refused before any request", async () => {
  const fetch = ignoringFetch();
  for (const project of ["..", ".", "a/b", ""]) {
    await assertRejects(
      () =>
        CloudMonitoringTasks.timeSeriesList((s) =>
          s.project(project).metricType("m").token(TOKEN).fetch(fetch.fetch)
        ),
      Error,
      "project",
    );
  }
  assertEquals(fetch.state.calls, 0);
  // A project number and a domain-scoped id are both project ids.
  for (const project of ["123456789012", "example.com:my-proj"]) {
    const ok = pages({});
    await CloudMonitoringTasks.timeSeriesList((s) =>
      s.project(project).metricType("m").token(TOKEN).fetch(ok.fetch)
    );
    assertEquals(ok.urls.length, 1);
  }
});

// L9 ------------------------------------------------------------------------

Deno.test("L9: an int64 sent as a JSON number keeps a decimal raw string", async () => {
  const [one] = await CloudMonitoringTasks.timeSeriesList((s) =>
    base(
      s,
      pages({ timeSeries: [{ points: [point(10, { int64Value: 1e21 })] }] })
        .fetch,
    )
  );
  assertEquals(one.points[0].value, {
    kind: "int64",
    value: 1e21,
    raw: "1000000000000000000000",
  });
});

// R3 ------------------------------------------------------------------------

Deno.test("R3: a failed Cloud Run canary command is a CommandError", async () => {
  const silent = cloudRunCanary((r) =>
    r.service("api").image("i").runner(() =>
      Promise.resolve(new CommandOutput(2, "", "denied"))
    )
  );
  const ctx = {
    state: {
      set: () => Promise.resolve(),
      trySet: () => Promise.resolve(true),
      get: () => ({}),
    },
    reportSummary: () => {},
  };
  await assertRejects(() => silent.stage(ctx), CommandError, "exit 2");
});

// R5 ------------------------------------------------------------------------

Deno.test("R5: the canary's log read names the analysis in its refusals", async () => {
  const error = await assertRejects(
    () =>
      cloudMonitoring((m) =>
        m.now(NOW).max(1).logEntries((l) => l.limit(0))
          .gcloud((g) => g.runner(recording("[]").run))
      ).validate(plain),
    Error,
    "cloudMonitoring",
  );
  assertEquals(error.message.includes("loggingRead"), false);
});

// H6, R6 (new API) ------------------------------------------------------------

Deno.test("H6: .delay(...) moves the window end back, for a read too", async () => {
  const fake = pages({});
  await CloudMonitoringTasks.timeSeriesList((s) =>
    base(s, fake.fetch).delay("90s")
  );
  assertEquals(
    fake.urls[0].searchParams.get("interval.endTime"),
    "2026-10-07T12:09:00.000Z",
  );
  const canary = pages({ timeSeries: [series([0])] });
  await cloudMonitoring((m) => base(m, canary.fetch).delay(0).max(5))
    .validate(plain);
  assertEquals(
    canary.urls[0].searchParams.get("interval.endTime"),
    "2026-10-07T12:10:30.000Z",
  );
});

Deno.test("R6: unusable reader output is a GcloudOutputError naming the reader", async () => {
  const error = await assertRejects(
    () => GcloudTasks.logEntryCount((s) => s.runner(recording("{}").run)),
    GcloudOutputError,
  );
  assertEquals(
    error instanceof GcloudOutputError && error.task,
    "GcloudTasks.logEntryCount",
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s, pages("aaaaaaaa").fetch)
      ),
    GcloudOutputError,
  );
  await assertRejects(
    () =>
      CloudMonitoringTasks.timeSeriesList((s) =>
        base(s, pages(new Response("aaaaaaaa")).fetch)
      ),
    GcloudOutputError,
  );
});

Deno.test("H3: latest skips a series with no points and finds the newest in any order", async () => {
  const body = {
    timeSeries: [
      { valueType: "DISTRIBUTION", points: [dist(10, 0, 0)] },
      {
        valueType: "DISTRIBUTION",
        points: [dist(8, 2, 40), dist(10, 2, 70), dist(9, 2, 50)],
      },
    ],
  };
  assertEquals(
    await CloudMonitoringTasks.metricValue((s) => base(s, pages(body).fetch)),
    70,
  );
});

Deno.test("M1: an aborted check stops the log count before gcloud runs", async () => {
  const controller = new AbortController();
  controller.abort();
  const gcloud = recording("[]");
  await assertRejects(() =>
    cloudMonitoring((m) =>
      m.now(NOW).max(1).logEntries((l) => l)
        .gcloud((g) => g.runner(gcloud.run))
    ).validate({ redact: plain.redact, signal: controller.signal })
  );
  assertEquals(gcloud.calls.length, 0);
  // Aborted while the candidate is read: the count does not run.
  const late = new AbortController();
  const candidate = (settings: GcloudSettings) => {
    late.abort();
    return recording("api-00002\n").run(settings);
  };
  const counted = recording("[]");
  await assertRejects(() =>
    cloudMonitoring((m) =>
      m.now(NOW).max(1).cloudRunCandidate("api").logEntries((l) => l)
        .gcloud((g) =>
          g.runner((s) =>
            s.argv().includes("describe") ? candidate(s) : counted.run(s)
          )
        )
    ).validate({ redact: plain.redact, signal: late.signal })
  );
  assertEquals(counted.calls.length, 0);
});
