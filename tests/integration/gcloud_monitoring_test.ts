// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: Cloud Monitoring and Cloud Logging through the real CLI entry
 * point. A build gates on a Cloud Run 5xx count read with
 * `CloudMonitoringTasks.metricValue`, and on a log-entry count read with
 * `GcloudTasks.logEntryCount`; a canary rollout's `cloudMonitoring(...)`
 * analysis promotes a healthy candidate and rolls an unhealthy one back.
 * The Monitoring API is answered by an injected `fetch` and `gcloud` by an
 * injected runner, so nothing is spawned and no project is needed.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { CommandOutput } from "../../packages/core/src/shell.ts";
import {
  cloudMonitoring,
  CloudMonitoringTasks,
  type CloudMonitoringTimeSeriesSettings,
  type GcloudSettings,
  GcloudTasks,
} from "../../packages/gcloud/mod.ts";
import { canary } from "../../packages/canary/mod.ts";
import { FakePlatform } from "../../packages/canary/tests/_platform.ts";
import { runCli, withoutMaskDirectives, withStateDir } from "./_harness.ts";

/** The obviously fake bearer token the fake API expects. */
const TOKEN = "aaaaaaaa";

/** The per-minute 5xx counts the fake API answers with, newest first. */
let counts: number[] = [0];

/** Every request URL the fake API was sent. */
let urls: URL[] = [];

/** A fake Cloud Monitoring API: one INT64 series of `counts`. */
const fakeFetch: typeof fetch = (input, init) => {
  urls.push(new URL(String(input)));
  if (new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`) {
    return Promise.resolve(new Response("", { status: 401 }));
  }
  const points = counts.map((count, i) => ({
    interval: {
      endTime: new Date(Date.UTC(2026, 9, 7, 11, 59 - i)).toISOString(),
    },
    value: { int64Value: String(count) },
  }));
  const body = counts.length === 0 ? {} : { timeSeries: [{ points }] };
  return Promise.resolve(new Response(JSON.stringify(body)));
};

/** The 5xx count of `revision`, as both the gate and the canary read it. */
function fiveXx<S extends CloudMonitoringTimeSeriesSettings>(
  s: S,
  revision: string,
): S {
  return s.project("my-proj").metricType("run.googleapis.com/request_count")
    .resourceType("cloud_run_revision")
    .resourceLabel("revision_name", revision)
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM")
    .token(TOKEN).fetch(fakeFetch);
}

class Gate extends Build {
  gate = target()
    .description(
      "Fail when the API's 5xx responses over 15 minutes are too many",
    )
    .executes(async () => {
      const errors = await CloudMonitoringTasks.metricValue((s) =>
        fiveXx(s, "api-00001").window("15m").aggregate("sum").missingDataAs(0)
      );
      if (!(errors <= 3)) {
        throw new Error(`api had ${errors} 5xx responses, over 3`);
      }
    });
}

Deno.test("a build gates on a Cloud Monitoring metric read through CloudMonitoringTasks", async () => {
  urls = [];
  counts = [1, 0, 1];
  const passed = await runCli(Gate, ["gate"]);
  assertEquals(passed.code, 0, passed.err);
  assertEquals(urls[0].pathname, "/v3/projects/my-proj/timeSeries");
  assertStringIncludes(
    urls[0].searchParams.get("filter") ?? "",
    'resource.labels.revision_name = "api-00001"',
  );
  counts = [2, 2, 1];
  const failed = await runCli(Gate, ["gate"]);
  assertEquals(failed.code, 1);
  assertStringIncludes(
    failed.out + failed.err,
    "api had 5 5xx responses, over 3",
  );
  // No data is zero for this gate.
  counts = [];
  assertEquals((await runCli(Gate, ["gate"])).code, 0);
});

/** The log entries the fake `gcloud logging read` answers with. */
let logEntries = 0;

/**
 * A fake gcloud: answers a Cloud Run revision read with the candidate's
 * name, and a log read with `logEntries` ids.
 */
function fakeGcloud(settings: GcloudSettings): Promise<CommandOutput> {
  const argv = settings.argv();
  calls.push(argv);
  if (argv.includes("describe")) {
    return Promise.resolve(new CommandOutput(0, "api-00002\n", ""));
  }
  const ids = Array.from(
    { length: logEntries },
    (_, i) => ({ insertId: `${i}` }),
  );
  return Promise.resolve(new CommandOutput(0, JSON.stringify(ids), ""));
}

/** Every argv the fake gcloud was handed. */
let calls: string[][] = [];

/** A secret parameter value — obviously fake — that ends up in a filter. */
const SECRET = "fake-secret-label-value";

class LogGate extends Build {
  gate = target()
    .description("Fail when the API logged errors in the last hour")
    .executes(async () => {
      const errors = await GcloudTasks.logEntryCount((s) =>
        s.resourceType("cloud_run_revision").minSeverity("ERROR")
          .freshness("1h").limit(100).project("my-proj").runner(fakeGcloud)
      );
      if (errors > 0) throw new Error(`api logged ${errors} errors`);
    });
}

Deno.test("a build gates on a log-entry count read through GcloudTasks", async () => {
  calls = [];
  logEntries = 0;
  const passed = await runCli(LogGate, ["gate"]);
  assertEquals(passed.code, 0, passed.err);
  assertEquals(calls[0].slice(1, 3), ["logging", "read"]);
  assertEquals(calls[0].includes("--limit=101"), true);
  logEntries = 2;
  const failed = await runCli(LogGate, ["gate"]);
  assertEquals(failed.code, 1);
  assertStringIncludes(failed.out + failed.err, "api logged 2 errors");
});

/** The platform the canary below drives; reset per test. */
let platform = new FakePlatform();

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => platform.describe(),
      stage: (ctx) => platform.stage(ctx),
      expose: (percent, ctx) => platform.expose(percent, ctx),
      promote: (ctx) => platform.promote(ctx),
      abort: (ctx) => platform.abort(ctx),
    })
      .steps(10)
      .analysis(cloudMonitoring((m) =>
        m.name("canary 5xx").project("my-proj")
          .metricType("run.googleapis.com/request_count")
          .resourceType("cloud_run_revision")
          .cloudRunCandidate("api", "europe-west1")
          .metricLabel("response_code_class", "5xx")
          .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
          .crossSeriesReducer("REDUCE_SUM")
          .window("5m").max(5).missingDataAs(0)
          .token(TOKEN).fetch(fakeFetch)
          .gcloud((g) => g.runner(fakeGcloud))
      ))
  );
}

Deno.test("canary's cloudMonitoring analysis promotes a healthy candidate", async () => {
  platform = new FakePlatform();
  urls = [];
  calls = [];
  counts = [0, 1, 0];
  await withStateDir(async () => {
    const { code, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 0, err);
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "promote rev-2"]);
    assertEquals(urls.length > 0, true);
    assertEquals(urls[0].searchParams.get("view"), "FULL");
    assertStringIncludes(
      urls[0].searchParams.get("filter") ?? "",
      'resource.labels.revision_name = "api-00002" AND ' +
        'resource.labels.location = "europe-west1" AND ' +
        'metric.labels.response_code_class = "5xx"',
    );
    assertEquals(calls[0].slice(1, 5), ["run", "services", "describe", "api"]);
    // The revision is read in the analysis's own project.
    assertEquals(calls[0][calls[0].indexOf("--project") + 1], "my-proj");
  });
});

Deno.test("canary's cloudMonitoring analysis rolls an unhealthy candidate back", async () => {
  platform = new FakePlatform();
  counts = [9];
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Deploy, ["rollout.promote"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "canary 5xx at");
    assertStringIncludes(out + err, "is 9, above the maximum 5");
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "abort rev-1"]);
  });
});

class Masked extends Build {
  label = parameter("label").secret().default(SECRET);

  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => platform.describe(),
      stage: (ctx) => platform.stage(ctx),
      expose: (percent, ctx) => platform.expose(percent, ctx),
      promote: (ctx) => platform.promote(ctx),
      abort: (ctx) => platform.abort(ctx),
    })
      .steps(10)
      .analysis(cloudMonitoring((m) =>
        m.name(`5xx of ${this.label.value}`).project("my-proj")
          .metricType("m").token(TOKEN).fetch(fakeFetch).max(5)
      ))
  );
}

Deno.test("a secret parameter in the analysis is masked in its failure", async () => {
  platform = new FakePlatform();
  counts = [9];
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Masked, ["rollout.promote"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "is 9, above the maximum 5");
    assertEquals(withoutMaskDirectives(out + err).includes(SECRET), false);
  });
});
