// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Azure Monitor: the commands' argv, and the metric reader's reading of
 * `monitor metrics list`.
 */

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  AzMonitorActivityLogListSettings,
  AzMonitorMetricsAlertListSettings,
  AzMonitorMetricsAlertShowSettings,
  AzMonitorMetricsListDefinitionsSettings,
  AzMonitorMetricsListSettings,
  type AzMonitorMetricValueSettings,
  AzOutputError,
  AzTasks,
} from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import { FakeAz, json } from "./_fake.ts";

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

/** One datapoint per value, a minute apart and oldest first; `null` is no data. */
function data(key: string, values: Array<number | null>) {
  return values.map((value, i) => ({
    timeStamp: new Date(Date.UTC(2026, 9, 7, 11, 55 + i)).toISOString(),
    ...(value === null ? {} : { [key]: value }),
  }));
}

/** A `value` list holding one metric with the given series. */
function metric(
  name: string,
  series: Array<ReturnType<typeof data>>,
  extra: Record<string, unknown> = {},
) {
  return {
    name: { value: name, localizedValue: name },
    timeseries: series.map((points) => ({ metadatavalues: [], data: points })),
    errorCode: "Success",
    ...extra,
  };
}

/** `metricValue` over `answer`, configured by `configure`. */
function read(
  answer: unknown,
  configure: Configure<AzMonitorMetricValueSettings> = (s) => s,
) {
  const fake = new FakeAz(json(answer));
  return {
    fake,
    value: AzTasks.metricValue((s) =>
      configure(
        s.resource("/subs/x/app").metrics("Requests").aggregation("Total")
          .window("5m", new Date("2026-10-07T12:00:00Z")).runner(fake.run),
      )
    ),
  };
}

Deno.test("metrics list: every option", () => {
  assertEquals(
    args(
      new AzMonitorMetricsListSettings().resource("/subs/x/app")
        .metrics("Requests", "Http5xx").aggregation("Total", "Average")
        .interval("PT5M").startTime(new Date("2026-10-07T11:00:00Z"))
        .endTime("2026-10-07T12:00:00Z").offset("90m")
        .dimension("Instance", "web-1").dimension("Code", "it's")
        .namespace("Microsoft.Web/sites").top(20).orderby("total desc"),
    ),
    [
      "monitor",
      "metrics",
      "list",
      "--resource=/subs/x/app",
      "--metrics",
      "Requests",
      "Http5xx",
      "--aggregation",
      "Total",
      "Average",
      "--interval=PT5M",
      "--start-time=2026-10-07T11:00:00.000Z",
      "--end-time=2026-10-07T12:00:00Z",
      "--offset=0d1h30m0s",
      "--filter=Instance eq 'web-1' and Code eq 'it''s'",
      "--namespace=Microsoft.Web/sites",
      "--top=20",
      "--orderby=total desc",
    ],
  );
  assertEquals(args(new AzMonitorMetricsListSettings().resource("r")), [
    "monitor",
    "metrics",
    "list",
    "--resource=r",
  ]);
  assertEquals(
    args(
      new AzMonitorMetricsListSettings().resource("r").filter("A eq '*'"),
    ),
    ["monitor", "metrics", "list", "--resource=r", "--filter=A eq '*'"],
  );
  assertEquals(
    args(new AzMonitorMetricsListSettings().resource("r").splitBy("A", "B")),
    ["monitor", "metrics", "list", "--resource=r", "--dimension", "A", "B"],
  );
  assertEquals(
    args(
      new AzMonitorMetricsListSettings().resource("r")
        .window("15m", new Date("2026-10-07T12:00:00Z")),
    ),
    [
      "monitor",
      "metrics",
      "list",
      "--resource=r",
      "--start-time=2026-10-07T11:45:00.000Z",
      "--end-time=2026-10-07T12:00:00.000Z",
    ],
  );
});

Deno.test("metrics list: refuses a missing resource and mixed filters", () => {
  assertThrows(
    () => new AzMonitorMetricsListSettings().argv(),
    Error,
    "no resource",
  );
  const mixed: Array<() => unknown> = [
    () =>
      new AzMonitorMetricsListSettings().resource("r").filter("a")
        .dimension("b", "c").argv(),
    () =>
      new AzMonitorMetricsListSettings().resource("r").filter("a")
        .splitBy("b").argv(),
    () =>
      new AzMonitorMetricsListSettings().resource("r").dimension("b", "c")
        .splitBy("b").argv(),
  ];
  for (const refuse of mixed) assertThrows(refuse, Error, "use one of");
  assertThrows(
    () => new AzMonitorMetricsListSettings().window(0),
    Error,
    "longer than zero",
  );
});

Deno.test("metrics list-definitions, alert list/show, activity-log list", () => {
  assertEquals(
    args(new AzMonitorMetricsListDefinitionsSettings().resource("r")),
    ["monitor", "metrics", "list-definitions", "--resource=r"],
  );
  assertEquals(
    args(
      new AzMonitorMetricsListDefinitionsSettings().resource("r")
        .namespace("ns"),
    ),
    [
      "monitor",
      "metrics",
      "list-definitions",
      "--resource=r",
      "--namespace=ns",
    ],
  );
  assertThrows(
    () => new AzMonitorMetricsListDefinitionsSettings().argv(),
    Error,
    "no resource",
  );
  assertEquals(args(new AzMonitorMetricsAlertListSettings()), [
    "monitor",
    "metrics",
    "alert",
    "list",
  ]);
  assertEquals(
    args(new AzMonitorMetricsAlertListSettings().resourceGroup("rg")),
    ["monitor", "metrics", "alert", "list", "--resource-group=rg"],
  );
  assertEquals(
    args(
      new AzMonitorMetricsAlertShowSettings().name("high-5xx")
        .resourceGroup("rg"),
    ),
    [
      "monitor",
      "metrics",
      "alert",
      "show",
      "--name=high-5xx",
      "--resource-group=rg",
    ],
  );
  assertEquals(args(new AzMonitorActivityLogListSettings()), [
    "monitor",
    "activity-log",
    "list",
  ]);
  assertEquals(
    args(
      new AzMonitorActivityLogListSettings()
        .startTime(new Date("2026-10-07T00:00:00Z")).endTime("2026-10-07T06:00")
        .offset("2h").resourceGroup("rg").resourceId("id")
        .namespace("Microsoft.Web").caller("ci@example.com").status("Failed")
        .correlationId("c-1").maxEvents(200).select("eventName", "status"),
    ),
    [
      "monitor",
      "activity-log",
      "list",
      "--start-time=2026-10-07T00:00:00.000Z",
      "--end-time=2026-10-07T06:00",
      "--offset=0d2h0m0s",
      "--resource-group=rg",
      "--resource-id=id",
      "--namespace=Microsoft.Web",
      "--caller=ci@example.com",
      "--status=Failed",
      "--correlation-id=c-1",
      "--max-events=200",
      "--select",
      "eventName",
      "status",
    ],
  );
});

Deno.test("metricValue: latest by default, aggregates on request", async () => {
  const answer = [metric("Requests", [data("total", [1, null, 4, 2])])];
  const latest = read(answer);
  assertEquals(await latest.value, 2);
  assertEquals(latest.fake.flag(0, "--output"), "json");
  assertEquals(latest.fake.flag(0, "--query"), "value");
  assertEquals(await read(answer, (s) => s.aggregate("sum")).value, 7);
  assertEquals(
    await read(answer, (s) => s.aggregate("average")).value,
    7 / 3,
  );
  assertEquals(await read(answer, (s) => s.aggregate("maximum")).value, 4);
  assertEquals(await read(answer, (s) => s.aggregate("minimum")).value, 1);
});

Deno.test("metricValue: every series counts, and the metric is named case-blind", async () => {
  const answer = [
    metric("Requests", [data("total", [1, 2]), data("total", [10])]),
  ];
  assertEquals(
    await read(answer, (s) => s.aggregate("sum").metric("requests")).value,
    13,
  );
});

Deno.test("metricValue: no data fails, unless missingDataAs says what it means", async () => {
  const empty = [metric("Requests", [data("total", [null, null])])];
  await assertRejects(
    () => read(empty).value,
    AzOutputError,
    "missingDataAs",
  );
  assertEquals(await read(empty, (s) => s.missingDataAs(0)).value, 0);
  await assertRejects(
    () => read(empty, (s) => s.missingDataAs(Infinity)).value,
    Error,
    "finite",
  );
});

Deno.test("metricValue: needs exactly one aggregation", async () => {
  const answer = [metric("Requests", [data("total", [1])])];
  await assertRejects(
    () => read(answer, (s) => s.aggregation("Average")).value,
    Error,
    "exactly one aggregation",
  );
  await assertRejects(
    () =>
      AzTasks.metricValue((s) =>
        s.resource("r").runner(new FakeAz(json(answer)).run)
      ),
    Error,
    "exactly one aggregation",
  );
});

Deno.test("metricValue: refuses an answer that may be cut at --top", async () => {
  const many = Array.from({ length: 10 }, () => data("total", [1]));
  await assertRejects(
    () => read([metric("Requests", many)], (s) => s.splitBy("Instance")).value,
    AzOutputError,
    "--top limit",
  );
  assertEquals(
    await read(
      [metric("Requests", many)],
      (s) => s.dimension("Instance", "*").top(50).aggregate("sum"),
    )
      .value,
    10,
  );
});

Deno.test("metricValue: refuses answers of the wrong shape", async () => {
  const cases: Array<[unknown, string]> = [
    [{}, "no list of metrics"],
    [[metric("A", []), metric("B", [])], "carries 2 metrics"],
    [[metric("Other", [])], 'no metric "Requests"'],
    [[metric("Requests", [], { errorCode: "Throttled" })], "error Throttled"],
    [[{ name: { value: "Requests" }, timeseries: {} }], "no timeseries list"],
    [[{
      name: { value: "Requests" },
      timeseries: [{ data: {} }],
    }], "no data list"],
    [[{ name: { value: "Requests" }, timeseries: [{}] }], "no data list"],
    [[{
      name: { value: "Requests" },
      timeseries: [{ data: [{ timeStamp: "nope", total: 1 }] }],
    }], "timeStamp that is a date"],
    [[{
      name: { value: "Requests" },
      timeseries: [{ data: [{ total: 1 }] }],
    }], "timeStamp that is a date"],
    [[{
      name: { value: "Requests" },
      timeseries: [{ data: [1] }],
    }], "timeStamp that is a date"],
    [[{
      name: { value: "Requests" },
      timeseries: [{
        data: [{ timeStamp: "2026-10-07T11:00:00Z", total: "1" }],
      }],
    }], "not a number"],
    [[{ name: "Requests" }], "no name"],
    [[1, { name: { value: 3 } }], 'no metric "Requests"'],
    [[{ name: { value: "Requests" }, timeseries: [1] }], "no data list"],
  ];
  for (const [answer, message] of cases) {
    const fake = new FakeAz(json(answer));
    // Name the metric unless the case is about the reader picking one.
    const named = !message.startsWith("carries") && message !== "no name";
    await assertRejects(
      () =>
        AzTasks.metricValue((s) => {
          s.resource("r").aggregation("Total").runner(fake.run);
          return named ? s.metric("Requests") : s;
        }),
      AzOutputError,
      message,
    );
  }
});
