// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  AwsCloudwatchDescribeAlarmsSettings,
  AwsCloudwatchGetMetricDataSettings,
  AwsCloudwatchGetMetricStatisticsSettings,
  type AwsCloudwatchMetricValueSettings,
  AwsOutputError,
  AwsTasks,
} from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import { FakeAws, json } from "./_fake.ts";

const END = new Date("2026-10-07T12:00:00.000Z");

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("get-metric-data renders typed queries to the API's JSON", () => {
  const argv = args(
    new AwsCloudwatchGetMetricDataSettings()
      .metricStat(
        "errors",
        (m) =>
          m.namespace("AWS/ApplicationELB").metricName(
            "HTTPCode_Target_5XX_Count",
          )
            .dimension("LoadBalancer", "app/web/1").period(300).stat("Sum")
            .unit("Count").label("5xx").returnData(false),
      )
      .metricStat(
        "requests",
        (m) =>
          m.namespace("AWS/ApplicationELB").metricName("RequestCount")
            .stat("p99.9"),
      )
      .expression(
        "ratio",
        "100 * errors / requests",
        (e) => e.label("ratio").period(300).returnData(true),
      )
      .expression("plain", "errors")
      .window("15m", END).scanBy("TimestampAscending").maxDatapoints(100),
  );
  assertEquals(argv.slice(0, 3), [
    "cloudwatch",
    "get-metric-data",
    "--metric-data-queries",
  ]);
  assertEquals(JSON.parse(argv[3]), [
    {
      Id: "errors",
      MetricStat: {
        Metric: {
          Namespace: "AWS/ApplicationELB",
          MetricName: "HTTPCode_Target_5XX_Count",
          Dimensions: [{ Name: "LoadBalancer", Value: "app/web/1" }],
        },
        Period: 300,
        Stat: "Sum",
        Unit: "Count",
      },
      Label: "5xx",
      ReturnData: false,
    },
    {
      Id: "requests",
      MetricStat: {
        Metric: {
          Namespace: "AWS/ApplicationELB",
          MetricName: "RequestCount",
          Dimensions: [],
        },
        Period: 60,
        Stat: "p99.9",
      },
      ReturnData: true,
    },
    {
      Id: "ratio",
      Expression: "100 * errors / requests",
      Label: "ratio",
      Period: 300,
      ReturnData: true,
    },
    { Id: "plain", Expression: "errors", ReturnData: true },
  ]);
  assertEquals(argv.slice(4), [
    "--start-time=2026-10-07T11:45:00.000Z",
    "--end-time=2026-10-07T12:00:00.000Z",
    "--scan-by=TimestampAscending",
    "--max-datapoints=100",
  ]);
});

Deno.test("get-metric-data takes explicit times as Date or text", () => {
  const argv = args(
    new AwsCloudwatchGetMetricDataSettings().expression("e", "1")
      .startTime("2026-10-07T00:00:00Z").endTime(END),
  );
  assertEquals(argv.slice(4), [
    "--start-time=2026-10-07T00:00:00Z",
    "--end-time=2026-10-07T12:00:00.000Z",
  ]);
});

Deno.test("get-metric-data refuses what CloudWatch would refuse", () => {
  assertThrows(
    () => new AwsCloudwatchGetMetricDataSettings().window("5m").argv(),
    Error,
    "no metric to read",
  );
  assertThrows(
    () => new AwsCloudwatchGetMetricDataSettings().expression("e", "1").argv(),
    Error,
    "no time range",
  );
  assertThrows(
    () =>
      new AwsCloudwatchGetMetricDataSettings().expression("e", "1")
        .expression("e", "2").window("5m").argv(),
    Error,
    'the id "e" is used twice',
  );
  assertThrows(
    () =>
      new AwsCloudwatchGetMetricDataSettings().expression("Bad-id", "1")
        .window("5m").argv(),
    Error,
    "is not a CloudWatch query id",
  );
  assertThrows(
    () =>
      new AwsCloudwatchGetMetricDataSettings()
        .metricStat("m", (m) => m.namespace("n").metricName("x"))
        .window("5m").argv(),
    Error,
    'metric "m" needs a namespace, a metric name and a statistic',
  );
  assertThrows(
    () => new AwsCloudwatchGetMetricDataSettings().window("0s"),
    Error,
    "longer than zero",
  );
});

Deno.test("get-metric-statistics with every option", () => {
  assertEquals(
    args(
      new AwsCloudwatchGetMetricStatisticsSettings().namespace("AWS/Lambda")
        .metricName("Errors").dimension("FunctionName", "api")
        .window("1h", END).period(300).statistics("Sum", "Maximum")
        .extendedStatistics("p99").unit("Count"),
    ),
    [
      "cloudwatch",
      "get-metric-statistics",
      "--namespace=AWS/Lambda",
      "--metric-name=Errors",
      "--dimensions",
      '[{"Name":"FunctionName","Value":"api"}]',
      "--start-time=2026-10-07T11:00:00.000Z",
      "--end-time=2026-10-07T12:00:00.000Z",
      "--period=300",
      "--statistics",
      "Sum",
      "Maximum",
      "--extended-statistics",
      "p99",
      "--unit=Count",
    ],
  );
  assertEquals(
    args(
      new AwsCloudwatchGetMetricStatisticsSettings().namespace("n").metricName(
        "m",
      )
        .startTime("a").endTime("b").period(60).extendedStatistics("p50"),
    ),
    [
      "cloudwatch",
      "get-metric-statistics",
      "--namespace=n",
      "--metric-name=m",
      "--start-time=a",
      "--end-time=b",
      "--period=60",
      "--extended-statistics",
      "p50",
    ],
  );
  assertThrows(
    () => new AwsCloudwatchGetMetricStatisticsSettings().namespace("n").argv(),
    Error,
    "the time range and the period",
  );
  assertThrows(
    () =>
      new AwsCloudwatchGetMetricStatisticsSettings().namespace("n").metricName(
        "m",
      )
        .window("1h").period(60).argv(),
    Error,
    "no statistic",
  );
});

Deno.test("describe-alarms with every option", () => {
  assertEquals(args(new AwsCloudwatchDescribeAlarmsSettings()), [
    "cloudwatch",
    "describe-alarms",
  ]);
  assertEquals(
    args(
      new AwsCloudwatchDescribeAlarmsSettings().alarmNames("a", "b")
        .alarmNamePrefix("api-").stateValue("ALARM").alarmTypes("MetricAlarm")
        .alarmTypes("CompositeAlarm"),
    ),
    [
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      "a",
      "b",
      "--alarm-name-prefix=api-",
      "--state-value=ALARM",
      "--alarm-types",
      "CompositeAlarm",
    ],
  );
});

/** A `MetricDataResults` entry. */
function series(
  id: string,
  points: Array<[string, number]>,
  status = "Complete",
): Record<string, unknown> {
  return {
    Id: id,
    Label: id,
    Timestamps: points.map(([t]) => t),
    Values: points.map(([, v]) => v),
    StatusCode: status,
  };
}

const POINTS: Array<[string, number]> = [
  ["2026-10-07T11:58:00Z", 4],
  ["2026-10-07T11:59:00Z", 6],
  ["2026-10-07T11:57:00Z", 2],
];

/** Read `results` through metricValue, configured by `configure`. */
function valueOf(
  results: unknown,
  configure: Configure<AwsCloudwatchMetricValueSettings> = (s) => s,
): Promise<number> {
  const fake = new FakeAws(
    json(Array.isArray(results) ? { MetricDataResults: results } : results),
  );
  return AwsTasks.metricValue((s) =>
    configure(s.expression("e", "1").window("5m", END).runner(fake.run))
  );
}

Deno.test("metricValue pins the results query and reads the latest datapoint", async () => {
  const fake = new FakeAws(
    json({ MetricDataResults: [series("errors", POINTS)] }),
  );
  const value = await AwsTasks.metricValue((s) =>
    s.metricStat(
      "errors",
      (m) => m.namespace("AWS/Lambda").metricName("Errors").stat("Sum"),
    )
      .window("5m", END).query("Messages").runner(fake.run)
  );
  assertEquals(value, 6);
  assertEquals(
    fake.flag(0, "--query"),
    "{MetricDataResults: MetricDataResults, NextToken: NextToken}",
  );
  assertEquals(fake.flag(0, "--output"), "json");
});

Deno.test("metricValue aggregates over the window", async () => {
  const results = [series("e", POINTS)];
  assertEquals(await valueOf(results, (s) => s.aggregate("sum")), 12);
  assertEquals(await valueOf(results, (s) => s.aggregate("average")), 4);
  assertEquals(await valueOf(results, (s) => s.aggregate("maximum")), 6);
  assertEquals(await valueOf(results, (s) => s.aggregate("minimum")), 2);
  assertEquals(await valueOf(results, (s) => s.aggregate("latest")), 6);
  // The newest datapoint is not always the largest.
  const rising = [series("e", [["2026-10-07T11:59:00Z", 1], [
    "2026-10-07T11:58:00Z",
    5,
  ]])];
  assertEquals(await valueOf(rising, (s) => s.aggregate("maximum")), 5);
});

Deno.test("metricValue merges a series split across pages", async () => {
  const results = [
    series("e", [["2026-10-07T11:50:00Z", 1]]),
    series("e", [["2026-10-07T11:55:00Z", 3]]),
  ];
  assertEquals(await valueOf(results), 3);
  assertEquals(await valueOf(results, (s) => s.aggregate("sum")), 4);
});

Deno.test("metricValue picks the series by id when there are several", async () => {
  const results = [
    series("a", [["2026-10-07T11:50:00Z", 1]]),
    series("b", [[
      "2026-10-07T11:50:00Z",
      2,
    ]]),
  ];
  assertEquals(await valueOf(results, (s) => s.id("b")), 2);
  await assertRejects(
    () => valueOf(results),
    AwsOutputError,
    "carries 2 series (a, b)",
  );
  await assertRejects(
    () => valueOf(results, (s) => s.id("c")),
    AwsOutputError,
    'no series "c"',
  );
});

Deno.test("metricValue fails clearly on no data, unless told what it means", async () => {
  const empty = [series("e", [])];
  await assertRejects(
    () => valueOf(empty),
    AwsOutputError,
    ".missingDataAs(0)",
  );
  assertEquals(await valueOf(empty, (s) => s.missingDataAs(0)), 0);
  // Data wins over the fallback.
  assertEquals(
    await valueOf([series("e", POINTS)], (s) => s.missingDataAs(0)),
    6,
  );
});

Deno.test("metricValue refuses a response it cannot trust", async () => {
  await assertRejects(
    () => valueOf({ Messages: [] }),
    AwsOutputError,
    "no MetricDataResults list",
  );
  await assertRejects(
    () => valueOf([series("e", POINTS, "Forbidden")]),
    AwsOutputError,
    "status Forbidden",
  );
  await assertRejects(
    () =>
      valueOf([{ Id: "e", Timestamps: ["2026-10-07T11:50:00Z"], Values: [] }]),
    AwsOutputError,
    "does not pair",
  );
  await assertRejects(
    () => valueOf([{ Id: "e", Timestamps: "x", Values: [1] }]),
    AwsOutputError,
    "does not pair",
  );
  await assertRejects(
    () => valueOf([{ Id: "e", Timestamps: ["soon"], Values: [1] }]),
    AwsOutputError,
    "not a date",
  );
  // Entries that are not series objects are skipped, not trusted.
  await assertRejects(
    () => valueOf(["junk", { Id: 7 }]),
    AwsOutputError,
    "carries 0 series",
  );
  await assertRejects(
    () => valueOf("not a document"),
    AwsOutputError,
    "no MetricDataResults list",
  );
  // A partial page carries its datapoints as usual.
  assertEquals(await valueOf([series("e", POINTS, "PartialData")]), 6);
});

Deno.test("alarmState reads a metric or composite alarm's state", async () => {
  const fake = new FakeAws(json([
    { AlarmName: "other", StateValue: "ALARM" },
    null,
    { AlarmName: "api-5xx", StateValue: "OK" },
  ]));
  assertEquals(
    await AwsTasks.alarmState(
      "api-5xx",
      (s) => s.region("eu-west-1").runner(fake.run),
    ),
    "OK",
  );
  assertEquals(fake.calls[0].slice(1), [
    "cloudwatch",
    "describe-alarms",
    "--alarm-names",
    "api-5xx",
    "--alarm-types",
    "MetricAlarm",
    "CompositeAlarm",
    "LogAlarm",
    "--region",
    "eu-west-1",
    "--output",
    "json",
    "--query",
    "[MetricAlarms, CompositeAlarms, LogAlarms][]",
  ]);
});

Deno.test("alarmState fails on a missing alarm or an unknown state", async () => {
  const read = (answer: unknown) =>
    AwsTasks.alarmState("a", (s) => s.runner(new FakeAws(json(answer)).run));
  await assertRejects(() => read([]), AwsOutputError, 'no alarm named "a"');
  await assertRejects(
    () => read([{ AlarmName: "a", StateValue: "MAYBE" }]),
    AwsOutputError,
    "no StateValue",
  );
  await assertRejects(() => read({}), AwsOutputError, "not a list");
  assertEquals(
    await read([{ AlarmName: "a", StateValue: "INSUFFICIENT_DATA" }]),
    "INSUFFICIENT_DATA",
  );
  assertEquals(await read([{ AlarmName: "a", StateValue: "ALARM" }]), "ALARM");
});
