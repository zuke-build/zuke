// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import { type AzMonitorAnalysisSettings, azureMonitor } from "../mod.ts";
import { FakeAz, json, withEmptyPath } from "./_fake.ts";

/** A context whose redactor masks one secret. */
const context = {
  redact: (text: string) => text.replaceAll("s3cr3t", "[redacted]"),
};

/** The clock every analysis below reads its window against. */
const NOW = new Date("2026-10-07T12:07:30Z");

/** A metrics list answer: one metric, one series, `values` a minute apart. */
function answer(values: Array<number | null>, key = "total"): string {
  return json([{
    name: { value: "requests/failed" },
    timeseries: [{
      metadatavalues: [],
      data: values.map((value, i) => ({
        timeStamp: new Date(Date.UTC(2026, 9, 7, 12, i)).toISOString(),
        ...(value === null ? {} : { [key]: value }),
      })),
    }],
    errorCode: "Success",
  }]);
}

/** The failed-requests analysis, answered by `fake`. */
function failures(
  fake: FakeAz,
  configure: Configure<AzMonitorAnalysisSettings> = (s) => s,
) {
  return azureMonitor((m) =>
    configure(
      m.name("canary failures").resource("/subs/x/insights/app")
        .metric("requests/failed").aggregation("Total")
        .dimension("cloud/roleName", "api-canary").max(5).now(() => NOW)
        .az((a) => a.subscription("prod").runner(fake.run)),
    )
  );
}

Deno.test("azureMonitor passes when every datapoint is within bounds", async () => {
  const fake = new FakeAz(answer([0, 5, null, 2]));
  const analysis = failures(fake);
  assertEquals(analysis.name, "azureMonitor");
  await analysis.validate(context);
  assertEquals(fake.calls[0], [
    "az",
    "monitor",
    "metrics",
    "list",
    "--resource=/subs/x/insights/app",
    "--metrics",
    "requests/failed",
    "--aggregation",
    "Total",
    "--interval=PT1M",
    "--start-time=2026-10-07T12:02:00.000Z",
    "--end-time=2026-10-07T12:07:00.000Z",
    "--filter=cloud/roleName eq 'api-canary'",
    "--subscription=prod",
    "--output=json",
    "--query=value",
  ]);
});

Deno.test("azureMonitor aligns the window to the interval", async () => {
  const fake = new FakeAz(answer([1]));
  await failures(
    fake,
    (m) => m.interval("PT5M").window("10m").namespace("ns"),
  ).validate(context);
  assertEquals(fake.flag(0, "--interval"), "PT5M");
  assertEquals(fake.flag(0, "--start-time"), "2026-10-07T11:55:00.000Z");
  assertEquals(fake.flag(0, "--end-time"), "2026-10-07T12:05:00.000Z");
  assertEquals(fake.flag(0, "--namespace"), "ns");
});

Deno.test("azureMonitor fails on a breach, naming the datapoint", async () => {
  const error = await assertRejects(() =>
    failures(new FakeAz(answer([1, 9]))).validate(context)
  );
  assertStringIncludes(
    error.message,
    "canary failures at 2026-10-07T12:01:00.000Z is 9, above the maximum 5.",
  );
  const low = await assertRejects(() =>
    failures(new FakeAz(answer([1])), (m) => m.min(2)).validate(context)
  );
  assertStringIncludes(low.message, "is 1, below the minimum 2");
});

Deno.test("azureMonitor fails on no data unless missingDataAs says what it means", async () => {
  const error = await assertRejects(() =>
    failures(new FakeAz(answer([null, null]))).validate(context)
  );
  assertStringIncludes(error.message, "has no data in the last 300000 ms");
  await failures(new FakeAz(answer([])), (m) => m.missingDataAs(0))
    .validate(context);
  const breach = await assertRejects(() =>
    failures(new FakeAz(answer([])), (m) => m.missingDataAs(10))
      .validate(context)
  );
  assertStringIncludes(breach.message, "canary failures (no data) is 10");
});

Deno.test("azureMonitor refuses settings that cannot work", async () => {
  const cases: Array<[Configure<AzMonitorAnalysisSettings>, string]> = [
    [(m) => m.metric("x").aggregation("Total").max(1), "needs a resource"],
    [(m) => m.resource("r").metric("x").max(1), "needs a resource"],
    [(m) => m.resource("r").metric("x").aggregation("Total"), "sets no bound"],
    [
      (m) => m.resource("r").metric("x").aggregation("Total").min(5).max(1),
      "can never pass",
    ],
    [(m) => m.resource("r").kql("w", "q").max(1), "not both"],
  ];
  for (const [configure, message] of cases) {
    const error = await assertRejects(() =>
      azureMonitor((m) =>
        configure(m.az((a) => a.runner(new FakeAz("[]").run)))
      ).validate(context)
    );
    assertStringIncludes(error.message, message);
  }
});

Deno.test("azureMonitor labels a failure by metric when it has no name", async () => {
  const error = await assertRejects(() =>
    azureMonitor((m) =>
      m.resource("r").metric("requests/failed").aggregation("Total").max(0)
        .now(() => NOW).az((a) => a.runner(new FakeAz(answer([3])).run))
    ).validate(context)
  );
  assertStringIncludes(error.message, "requests/failed at");
  const unnamed = await assertRejects(() =>
    azureMonitor((m) => m.max(1)).validate(context)
  );
  assertStringIncludes(unnamed.message, "azure monitor metric");
});

Deno.test("azureMonitor redacts every failure", async () => {
  const fromLambda = await assertRejects(() =>
    azureMonitor(() => {
      throw new Error("could not resolve s3cr3t");
    }).validate(context)
  );
  assertEquals(fromLambda.message.includes("s3cr3t"), false);
  const fromCommand = await assertRejects(() =>
    failures(
      new FakeAz(new CommandOutput(1, "", "AuthorizationFailed for s3cr3t")),
      (m) => m.name("s3cr3t metric"),
    ).validate(context)
  );
  assertEquals(fromCommand.message.includes("s3cr3t"), false);
  assertStringIncludes(fromCommand.message, "could not be read");
  const fromBreach = await assertRejects(() =>
    failures(new FakeAz(answer([9])), (m) => m.name("s3cr3t")).validate(
      context,
    )
  );
  assertEquals(fromBreach.message.includes("s3cr3t"), false);
  const fromNoData = await assertRejects(() =>
    failures(new FakeAz(answer([])), (m) => m.name("s3cr3t")).validate(context)
  );
  assertEquals(fromNoData.message.includes("s3cr3t"), false);
});

Deno.test("azureMonitor spawns az when .az(...) sets no runner", async () => {
  await withEmptyPath(async () => {
    await assertRejects(
      () =>
        azureMonitor((m) =>
          m.resource("r").metric("m").aggregation("Total").max(1)
        ).validate(context),
      Error,
      "could not be read",
    );
  });
});

/** A KQL analysis answered by `fake`. */
function kql(
  fake: FakeAz,
  configure: Configure<AzMonitorAnalysisSettings> = (s) => s,
) {
  return azureMonitor((m) =>
    configure(
      m.name("5xx count").kql("ws-1", "AppRequests | summarize n = count()")
        .window("10m").max(5).az((a) => a.runner(fake.run)),
    )
  );
}

Deno.test("azureMonitor's KQL mode judges the one number the query returns", async () => {
  const fake = new FakeAz(json([{ TableName: "PrimaryResult", n: "3" }]));
  await kql(fake).validate(context);
  assertEquals(fake.calls[0], [
    "az",
    "monitor",
    "log-analytics",
    "query",
    "--workspace=ws-1",
    "--analytics-query=AppRequests | summarize n = count()",
    "--timespan=PT600S",
    "--output=json",
    "--query=@",
  ]);
  const error = await assertRejects(() =>
    kql(new FakeAz(json([{ TableName: "T", n: "7.5" }]))).validate(context)
  );
  assertStringIncludes(error.message, "5xx count is 7.5, above the maximum 5");
});

Deno.test("azureMonitor's KQL mode treats no row or an empty cell as no data", async () => {
  for (const rows of [[], [{ TableName: "T", n: "None" }], [{ n: "" }]]) {
    await assertRejects(
      () => kql(new FakeAz(json(rows))).validate(context),
      Error,
      "has no data",
    );
    await kql(new FakeAz(json(rows)), (m) => m.missingDataAs(0))
      .validate(context);
  }
});

Deno.test("azureMonitor's KQL mode refuses an answer that is not one number", async () => {
  const cases: Array<[unknown, string]> = [
    [[{ n: "1" }, { n: "2" }], "one row with one column"],
    [[{ a: "1", b: "2" }], "one row with one column"],
    [[{ n: "many" }], 'column "n" is not a number'],
  ];
  for (const [rows, message] of cases) {
    await assertRejects(
      () => kql(new FakeAz(json(rows))).validate(context),
      Error,
      message,
    );
  }
});

Deno.test("azureMonitor refuses a NaN bound, takes a minimum alone, and reports a thrown non-Error", async () => {
  const nan = await assertRejects(() =>
    kql(new FakeAz(json([{ n: "1" }])), (m) => m.max(NaN)).validate(context)
  );
  assertStringIncludes(nan.message, "finite");
  await azureMonitor((m) =>
    m.kql("w", "q").min(1).az((a) =>
      a.runner(new FakeAz(json([{ n: "2" }])).run)
    )
  ).validate(context);
  const thrown = await assertRejects(() =>
    azureMonitor(() => {
      throw "a s3cr3t string";
    }).validate(context)
  );
  assertEquals(thrown.message, "a [redacted] string");
});
