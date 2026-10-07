// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import {
  AwsLogsFilterLogEventsSettings,
  AwsLogsGetQueryResultsSettings,
  type AwsLogsInsightsQuerySettings,
  AwsLogsQueryError,
  AwsLogsStartQuerySettings,
  AwsLogsStopQuerySettings,
  AwsLogsTailSettings,
  AwsOutputError,
  AwsTasks,
} from "../mod.ts";
import { FakeAws, json } from "./_fake.ts";

const END = new Date("2026-10-07T12:00:00.000Z");

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("logs start-query sends epoch seconds", () => {
  assertEquals(
    args(
      new AwsLogsStartQuerySettings().logGroupNames("/ecs/api", "/ecs/web")
        .queryString("fields @message").window("15m", END).limit(50),
    ),
    [
      "logs",
      "start-query",
      "--log-group-names",
      "/ecs/api",
      "/ecs/web",
      "--start-time=1791373500",
      "--end-time=1791374400",
      "--query-string=fields @message",
    ].concat(["--limit=50"]),
  );
  assertEquals(
    args(
      new AwsLogsStartQuerySettings().logGroupNames("g").queryString("q")
        .startTime(new Date(1500)).endTime(new Date(2500)),
    ),
    [
      "logs",
      "start-query",
      "--log-group-names",
      "g",
      "--start-time=1",
      "--end-time=2",
      "--query-string=q",
    ],
  );
  assertThrows(
    () => new AwsLogsStartQuerySettings().logGroupNames("g").argv(),
    Error,
    "a query needs log groups",
  );
});

Deno.test("logs get-query-results and stop-query", () => {
  assertEquals(args(new AwsLogsGetQueryResultsSettings().queryId("q-1")), [
    "logs",
    "get-query-results",
    "--query-id=q-1",
  ]);
  assertThrows(
    () => new AwsLogsGetQueryResultsSettings().argv(),
    Error,
    "queryId",
  );
  assertEquals(args(new AwsLogsStopQuerySettings().queryId("q-1")), [
    "logs",
    "stop-query",
    "--query-id=q-1",
  ]);
  assertThrows(() => new AwsLogsStopQuerySettings().argv(), Error, "queryId");
});

Deno.test("logs filter-log-events sends epoch milliseconds", () => {
  assertEquals(
    args(
      new AwsLogsFilterLogEventsSettings().logGroupName("/ecs/api")
        .logStreamNames("a", "b").logStreamNamePrefix("api/")
        .filterPattern("ERROR").window("1m", END),
    ),
    [
      "logs",
      "filter-log-events",
      "--log-group-name=/ecs/api",
      "--log-stream-names",
      "a",
      "b",
      "--log-stream-name-prefix=api/",
      "--filter-pattern=ERROR",
      "--start-time=1791374340000",
      "--end-time=1791374400000",
    ],
  );
  assertEquals(
    args(
      new AwsLogsFilterLogEventsSettings().logGroupName("g")
        .startTime(new Date(5)).endTime(new Date(9)),
    ),
    [
      "logs",
      "filter-log-events",
      "--log-group-name=g",
      "--start-time=5",
      "--end-time=9",
    ],
  );
  assertEquals(args(new AwsLogsFilterLogEventsSettings().logGroupName("g")), [
    "logs",
    "filter-log-events",
    "--log-group-name=g",
  ]);
  assertThrows(
    () => new AwsLogsFilterLogEventsSettings().argv(),
    Error,
    "logGroupName",
  );
});

Deno.test("logs tail with every option", () => {
  assertEquals(
    args(
      new AwsLogsTailSettings().groupName("/ecs/api").since("10m").follow()
        .filterPattern("ERROR").format("short").logStreamNames("s")
        .logStreamNamePrefix("api/"),
    ),
    [
      "logs",
      "tail",
      "/ecs/api",
      "--since=10m",
      "--follow",
      "--filter-pattern=ERROR",
      "--format=short",
      "--log-stream-names",
      "s",
      "--log-stream-name-prefix=api/",
    ],
  );
  assertEquals(args(new AwsLogsTailSettings().groupName("g")), [
    "logs",
    "tail",
    "g",
  ]);
  assertThrows(() => new AwsLogsTailSettings().argv(), Error, "groupName");
});

/** Answers for one get-query-results poll. */
function poll(status: string, results: unknown = []): string {
  return json({ status, results, statistics: { recordsMatched: 1 } });
}

/** A Logs Insights query against `fake`, quick to poll. */
function query(
  fake: FakeAws,
  configure: Configure<AwsLogsInsightsQuerySettings> = (q) => q,
) {
  return AwsTasks.logsInsightsQuery((q) =>
    configure(
      q.logGroupNames("/ecs/api").queryString("stats count(*)")
        .window("30m", END).pollInterval(1)
        .aws((a) => a.region("eu-west-1").runner(fake.run)),
    )
  );
}

Deno.test("logsInsightsQuery polls until Complete and returns the rows", async () => {
  const fake = new FakeAws(
    json({ queryId: "q-1" }),
    poll("Scheduled"),
    poll("Running"),
    poll("Complete", [
      [{ field: "bin(5m)", value: "2026-10-07 11:55:00.000" }, {
        field: "count(*)",
        value: "3",
      }],
      [{ field: "count(*)", value: "1" }],
    ]),
  );
  const rows = await query(fake, (q) => q.limit(10));
  assertEquals(rows, [
    { "bin(5m)": "2026-10-07 11:55:00.000", "count(*)": "3" },
    { "count(*)": "1" },
  ]);
  assertEquals(fake.calls.length, 4);
  assertEquals(fake.calls[0].slice(1, 3), ["logs", "start-query"]);
  assertEquals(fake.flag(0, "--limit"), "10");
  assertEquals(fake.flag(0, "--region"), "eu-west-1");
  assertEquals(fake.flag(0, "--output"), "json");
  for (const call of fake.calls.slice(1)) {
    assertEquals(call.slice(1, 4), [
      "logs",
      "get-query-results",
      "--query-id=q-1",
    ]);
    assertEquals(call.includes("eu-west-1"), true);
  }
});

Deno.test("logsInsightsQuery takes an explicit time range", async () => {
  const fake = new FakeAws(json({ queryId: "q" }), poll("Complete"));
  await AwsTasks.logsInsightsQuery((q) =>
    q.logGroupNames("g").queryString("q").startTime(new Date(1000))
      .endTime(new Date(2000)).aws((a) => a.runner(fake.run))
  );
  assertEquals(fake.flag(0, "--start-time"), "1");
  assertEquals(fake.flag(0, "--end-time"), "2");
});

Deno.test("logsInsightsQuery fails on Failed, Cancelled and Timeout", async () => {
  for (const status of ["Failed", "Cancelled", "Timeout", "Unknown"]) {
    const fake = new FakeAws(json({ queryId: "q-2" }), poll(status));
    const error = await assertRejects(
      () => query(fake),
      AwsLogsQueryError,
      `status ${status}`,
    );
    assertEquals(error instanceof AwsLogsQueryError && error.queryId, "q-2");
    assertEquals(error instanceof AwsLogsQueryError && error.status, status);
  }
});

Deno.test("logsInsightsQuery stops a query that outlasts its timeout", async () => {
  const fake = new FakeAws(
    json({ queryId: "q-3" }),
    (argv) =>
      new CommandOutput(
        0,
        argv.includes("stop-query") ? json({ success: true }) : poll("Running"),
        "",
      ),
  );
  const error = await assertRejects(
    () => query(fake, (q) => q.timeout("20ms").pollInterval("1ms")),
    AwsLogsQueryError,
    "still Running",
  );
  assertStringIncludes(error.message, "raise .timeout(...)");
  const last = fake.calls[fake.calls.length - 1];
  assertEquals(last.slice(1, 4), ["logs", "stop-query", "--query-id=q-3"]);
});

Deno.test("a failure to stop the query does not hide the timeout", async () => {
  const fake = new FakeAws(
    json({ queryId: "q-4" }),
    (argv) =>
      argv.includes("stop-query")
        ? new CommandOutput(254, "", "InvalidParameterException")
        : new CommandOutput(0, poll("Running"), ""),
  );
  await assertRejects(
    () => query(fake, (q) => q.timeout(0)),
    AwsLogsQueryError,
    "still Running",
  );
  const thrower = new FakeAws(json({ queryId: "q-5" }), poll("Running"));
  let polls = 0;
  await assertRejects(
    () =>
      AwsTasks.logsInsightsQuery((q) =>
        q.logGroupNames("g").queryString("q").window("5m").timeout(0).aws((a) =>
          a.runner((settings) => {
            if (settings.argv().includes("stop-query")) {
              return Promise.reject(new Error("network down"));
            }
            polls++;
            return thrower.run(settings);
          })
        )
      ),
    AwsLogsQueryError,
    "still Running",
  );
  assertEquals(polls, 2);
});

Deno.test("logsInsightsQuery refuses answers of the wrong shape", async () => {
  const cases: Array<[string[], string]> = [
    [["not json"], "not JSON"],
    [[json({})], "no queryId"],
    [[json({ queryId: "q" }), json({ results: [] })], "no status"],
    [[json({ queryId: "q" }), json({ status: "Complete" })], "no results"],
    [[json({ queryId: "q" }), poll("Complete", ["x"])], "not a list of fields"],
    [
      [json({ queryId: "q" }), poll("Complete", [[{ field: "a", value: 1 }]])],
      "{ field, value }",
    ],
    [[json({ queryId: "q" }), poll("Complete", [[null]])], "{ field, value }"],
  ];
  for (const [answers, message] of cases) {
    await assertRejects(
      () => query(new FakeAws(...answers)),
      AwsOutputError,
      message,
    );
  }
});
