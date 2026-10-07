// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import { cloudwatch, type CloudwatchAnalysisSettings } from "../mod.ts";
import { FakeAws, json } from "./_fake.ts";

/** A context whose redactor masks one secret. */
const context = {
  redact: (text: string) => text.replaceAll("s3cr3t", "[redacted]"),
};

/** A `MetricDataResults` list with one series. */
function results(id: string, values: number[]): string {
  return json([{
    Id: id,
    Timestamps: values.map((_, i) =>
      new Date(Date.UTC(2026, 9, 7, 11, 59 - i)).toISOString()
    ),
    Values: values,
    StatusCode: "Complete",
  }]);
}

/** The 5xx analysis, answered by `fake`. */
function errors5xx(
  fake: FakeAws,
  configure: Configure<CloudwatchAnalysisSettings> = (s) => s,
) {
  return cloudwatch((s) =>
    configure(
      s.name("canary 5xx").namespace("AWS/ApplicationELB")
        .metric("HTTPCode_Target_5XX_Count")
        .dimension("TargetGroup", "targetgroup/api-canary/0a1b").stat("Sum")
        .max(5).region("eu-west-1").profile("deploy").runner(fake.run),
    )
  );
}

Deno.test("cloudwatch passes when every datapoint is within bounds", async () => {
  const fake = new FakeAws(results("m1", [0, 5, 2]));
  const analysis = errors5xx(fake);
  assertEquals(analysis.name, "cloudwatch");
  await analysis.validate(context);
  const argv = fake.calls[0];
  assertEquals(argv.slice(1, 3), ["cloudwatch", "get-metric-data"]);
  assertEquals(JSON.parse(fake.flag(0, "--metric-data-queries") ?? ""), [{
    Id: "m1",
    MetricStat: {
      Metric: {
        Namespace: "AWS/ApplicationELB",
        MetricName: "HTTPCode_Target_5XX_Count",
        Dimensions: [{
          Name: "TargetGroup",
          Value: "targetgroup/api-canary/0a1b",
        }],
      },
      Period: 60,
      Stat: "Sum",
    },
    ReturnData: true,
  }]);
  assertEquals(fake.flag(0, "--region"), "eu-west-1");
  assertEquals(fake.flag(0, "--profile"), "deploy");
  assertEquals(fake.flag(0, "--output"), "json");
  assertEquals(fake.flag(0, "--query"), "MetricDataResults");
  // The window ends on a minute boundary, five minutes after it starts.
  const start = Date.parse(fake.flag(0, "--start-time") ?? "");
  const end = Date.parse(fake.flag(0, "--end-time") ?? "");
  assertEquals(end % 60_000, 0);
  assertEquals(end - start, 5 * 60_000);
});

Deno.test("cloudwatch fails on a breach, naming the metric, value and bound", async () => {
  const fake = new FakeAws(results("m1", [1, 7]));
  await assertRejects(
    () => errors5xx(fake).validate(context),
    Error,
    "canary 5xx at 2026-10-07T11:58:00.000Z is 7, above the maximum 5.",
  );
});

Deno.test("cloudwatch checks a minimum too", async () => {
  const fake = new FakeAws(results("m1", [99.5]));
  await assertRejects(
    () =>
      cloudwatch((s) =>
        s.namespace("Custom").metric("SuccessRate").stat("Average").min(99.9)
          .window("10m").period(300).unit("Percent").runner(fake.run)
      ).validate(context),
    Error,
    "SuccessRate at 2026-10-07T11:59:00.000Z is 99.5, below the minimum 99.9.",
  );
  const query = JSON.parse(fake.flag(0, "--metric-data-queries") ?? "");
  assertEquals(query[0].MetricStat.Period, 300);
  assertEquals(query[0].MetricStat.Unit, "Percent");
});

Deno.test("cloudwatch fails on no data unless told what it means", async () => {
  await assertRejects(
    () => errors5xx(new FakeAws(results("m1", []))).validate(context),
    Error,
    "canary 5xx has no datapoints in the last 300000 ms",
  );
  await errors5xx(new FakeAws(results("m1", [])), (s) => s.missingDataAs(0))
    .validate(context);
  await assertRejects(
    () =>
      errors5xx(new FakeAws(results("m1", [])), (s) => s.missingDataAs(9))
        .validate(context),
    Error,
    "canary 5xx (no data) is 9, above the maximum 5.",
  );
});

Deno.test("cloudwatch judges an expression over hidden metrics", async () => {
  const fake = new FakeAws(results("e1", [0.4]));
  await cloudwatch((s) =>
    s.metricStat(
      "errors",
      (m) =>
        m.namespace("AWS/ApplicationELB").metricName(
          "HTTPCode_Target_5XX_Count",
        )
          .stat("Sum"),
    )
      .metricStat(
        "requests",
        (m) =>
          m.namespace("AWS/ApplicationELB").metricName("RequestCount")
            .stat("Sum"),
      )
      .expression("100 * errors / requests").max(1).runner(fake.run)
  ).validate(context);
  const queries = JSON.parse(fake.flag(0, "--metric-data-queries") ?? "");
  assertEquals(
    queries.map((q: { Id: string; ReturnData: boolean }) => [
      q.Id,
      q.ReturnData,
    ]),
    [["errors", false], ["requests", false], ["e1", true]],
  );
  // The expression names the failure when the analysis has no name.
  await assertRejects(
    () =>
      cloudwatch((s) =>
        s.namespace("n").metric("m").stat("Sum").expression("m1 * 2").max(0)
          .runner(new FakeAws(results("e1", [2])).run)
      ).validate(context),
    Error,
    "m1 * 2 at",
  );
});

Deno.test("cloudwatch judges a lone metricStat by its own id", async () => {
  const fake = new FakeAws(results("lat", [120]));
  await assertRejects(
    () =>
      cloudwatch((s) =>
        s.metricStat(
          "lat",
          (m) => m.namespace("AWS/Lambda").metricName("Duration").stat("p99"),
        )
          .max(100).runner(fake.run)
      ).validate(context),
    Error,
    "cloudwatch metric at",
  );
});

Deno.test("cloudwatch refuses settings that cannot be judged", async () => {
  const cases: Array<[Configure<CloudwatchAnalysisSettings>, string]> = [
    [(s) => s.namespace("n").metric("m").stat("Sum"), "sets no bound"],
    [(s) => s.max(1), "reads 0 metrics but judges one"],
    [
      (s) =>
        s.namespace("n").metric("m").stat("Sum")
          .metricStat("b", (m) => m.namespace("n").metricName("x").stat("Sum"))
          .max(1),
      "reads 2 metrics",
    ],
    [(s) => s.metric("m").stat("Sum").max(1), "needs a namespace"],
    [(s) => s.namespace("n").stat("Sum").max(1), "needs a namespace"],
    [(s) => s.namespace("n").metric("m").max(1), "a statistic"],
    [
      (s) => s.namespace("n").metric("m").stat("Sum").min(2).max(1),
      "never pass",
    ],
    [(s) => s.namespace("n").metric("m").stat("Sum").max(NaN), "not a number"],
  ];
  for (const [configure, message] of cases) {
    const fake = new FakeAws(results("m1", [0]));
    await assertRejects(
      () => cloudwatch((s) => configure(s.runner(fake.run))).validate(context),
      Error,
      message,
    );
    assertEquals(fake.calls.length, 0);
  }
  await assertRejects(
    () => cloudwatch((s) => s.missingDataAs(Infinity)).validate(context),
    Error,
    "finite number",
  );
});

Deno.test("cloudwatch reports a read failure, redacted", async () => {
  const failing = new FakeAws(
    new CommandOutput(254, "", "AccessDenied for token s3cr3t"),
  );
  const error = await assertRejects(
    () => errors5xx(failing).validate(context),
    Error,
    "canary 5xx could not be read:",
  );
  assertStringIncludes(error.message, "[redacted]");
  assertEquals(error.message.includes("s3cr3t"), false);
  await assertRejects(
    () =>
      errors5xx(new FakeAws(json([{ Id: "m1", StatusCode: "Forbidden" }])))
        .validate(context),
    Error,
    "status Forbidden",
  );
  await assertRejects(
    () =>
      cloudwatch((s) =>
        s.namespace("n").metric("m").stat("Sum").max(1)
          .runner(() => Promise.reject("socket closed"))
      ).validate(context),
    Error,
    "could not be read: socket closed",
  );
});

Deno.test("cloudwatch applies further global options last", async () => {
  const fake = new FakeAws(results("m1", [0]));
  await errors5xx(fake, (s) => s.aws((a) => a.endpointUrl("http://localhost")))
    .validate(context);
  assertEquals(fake.flag(0, "--endpoint-url"), "http://localhost");
});
