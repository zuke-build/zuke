// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The readers: what each pins, what it returns, and how it fails.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import { AzOutputError, AzTasks } from "../mod.ts";
import { FakeAz, json, withEmptyPath } from "./_fake.ts";

Deno.test("subscriptionId and tenantId pin a tsv projection after the lambda", async () => {
  const fake = new FakeAz("00000000-1111\n", "tenant-2222\n");
  assertEquals(
    await AzTasks.subscriptionId((s) =>
      s.subscription("prod").query("name").output("table").runner(fake.run)
    ),
    "00000000-1111",
  );
  assertEquals(
    await AzTasks.tenantId((s) => s.runner(fake.run)),
    "tenant-2222",
  );
  assertEquals(fake.calls[0], [
    "az",
    "account",
    "show",
    "--subscription=prod",
    "--output=tsv",
    "--query=id",
  ]);
  assertEquals(fake.flag(1, "--query"), "tenantId");
});

Deno.test("a scalar reader refuses an empty or multi-line answer", async () => {
  await assertRejects(
    () => AzTasks.subscriptionId((s) => s.runner(new FakeAz("\n").run)),
    AzOutputError,
    "printed nothing",
  );
  await assertRejects(
    () =>
      AzTasks.webAppHostName((s) =>
        s.name("w").resourceGroup("g").runner(new FakeAz("a\nb\n").run)
      ),
    AzOutputError,
    "more than one line",
  );
});

Deno.test("a reader refuses a truncated capture", async () => {
  const truncated = new CommandOutput(0, "abc", "", true, 16);
  await assertRejects(
    () => AzTasks.subscriptionId((s) => s.runner(new FakeAz(truncated).run)),
    AzOutputError,
    "capture cap",
  );
});

Deno.test("accessToken pins json and returns the token", async () => {
  const fake = new FakeAz(json("eyJ0eXAi.token.value"));
  assertEquals(
    await AzTasks.accessToken((s) =>
      s.resource("https://vault.azure.net").output("tsv").runner(fake.run)
    ),
    "eyJ0eXAi.token.value",
  );
  assertEquals(fake.flag(0, "--output"), "json");
  assertEquals(fake.flag(0, "--query"), "accessToken");
  await assertRejects(
    () => AzTasks.accessToken((s) => s.runner(new FakeAz("null").run)),
    AzOutputError,
    "no accessToken",
  );
});

Deno.test("acrToken forces --expose-token", async () => {
  const fake = new FakeAz(json("acr-refresh-token-1"));
  assertEquals(
    await AzTasks.acrToken((s) => s.name("reg").runner(fake.run)),
    "acr-refresh-token-1",
  );
  assertEquals(fake.calls[0].includes("--expose-token"), true);
  assertEquals(fake.flag(0, "--query"), "accessToken");
});

Deno.test("secretValue returns a multi-line value exactly", async () => {
  const value = "line one\n  line two  \n";
  const fake = new FakeAz(json(value));
  assertEquals(
    await AzTasks.secretValue((s) =>
      s.vaultName("kv").name("db").runner(fake.run)
    ),
    value,
  );
  assertEquals(fake.flag(0, "--query"), "value");
  await assertRejects(
    () => AzTasks.secretValue((s) => s.id("x").runner(new FakeAz("{}").run)),
    AzOutputError,
    "no value",
  );
});

Deno.test("a JSON reader's parse error never quotes the output", async () => {
  const error = await assertRejects(
    () =>
      AzTasks.secretValue((s) =>
        s.id("x").runner(new FakeAz("not-json super-secret").run)
      ),
    AzOutputError,
    "not JSON",
  );
  assertEquals(error.message.includes("super-secret"), false);
});

Deno.test("containerAppFqdn and webAppHostName", async () => {
  const fake = new FakeAz(
    "api.example.azurecontainerapps.io\n",
    "web.azurewebsites.net\n",
  );
  assertEquals(
    await AzTasks.containerAppFqdn((s) =>
      s.name("api").resourceGroup("rg").runner(fake.run)
    ),
    "api.example.azurecontainerapps.io",
  );
  assertEquals(
    await AzTasks.webAppHostName((s) =>
      s.name("web").resourceGroup("rg").runner(fake.run)
    ),
    "web.azurewebsites.net",
  );
  assertEquals(
    fake.flag(0, "--query"),
    "properties.configuration.ingress.fqdn",
  );
  assertEquals(fake.flag(1, "--query"), "defaultHostName");
  const error = await assertRejects(
    () =>
      AzTasks.containerAppFqdn((s) =>
        s.name("api").resourceGroup("rg").runner(new FakeAz("\n").run)
      ),
    AzOutputError,
  );
  assertStringIncludes(error.message, "ingress enabled");
});

Deno.test("resourceGroupExists reads true or false", async () => {
  const fake = new FakeAz("true\n", "false\n", '"maybe"');
  assertEquals(
    await AzTasks.resourceGroupExists("rg", (s) => s.runner(fake.run)),
    true,
  );
  assertEquals(
    await AzTasks.resourceGroupExists("rg", (s) => s.runner(fake.run)),
    false,
  );
  await assertRejects(
    () => AzTasks.resourceGroupExists("rg", (s) => s.runner(fake.run)),
    AzOutputError,
    "true or false",
  );
  assertEquals(fake.calls[0], [
    "az",
    "group",
    "exists",
    "--name=rg",
    "--output=json",
    "--query=@",
  ]);
});

Deno.test("deploymentOutput finds an output by name, any case", async () => {
  const outputs = {
    apiUrl: { type: "String", value: "https://api.example.com" },
    replicas: { type: "Int", value: 3 },
    config: { type: "Object", value: { a: 1 } },
  };
  const fake = new FakeAz(json(outputs));
  const read = (key: string) =>
    AzTasks.deploymentOutput(
      "rg",
      "rel",
      key,
      (s) => s.name("ignored").runner(fake.run),
    );
  assertEquals(await read("apiUrl"), "https://api.example.com");
  assertEquals(await read("APIURL"), "https://api.example.com");
  assertEquals(await read("replicas"), "3");
  assertEquals(await read("config"), '{"a":1}');
  assertEquals(fake.calls[0], [
    "az",
    "deployment",
    "group",
    "show",
    "--name=rel",
    "--resource-group=rg",
    "--output=json",
    "--query=properties.outputs",
  ]);
  await assertRejects(
    () => read("missing"),
    AzOutputError,
    'no output "missing"',
  );
  await assertRejects(
    () =>
      AzTasks.deploymentOutput(
        "rg",
        "rel",
        "x",
        (s) => s.runner(new FakeAz("null").run),
      ),
    AzOutputError,
    "has no outputs",
  );
});

Deno.test("logAnalyticsQuery returns the rows as strings", async () => {
  const fake = new FakeAz(json([
    { TableName: "PrimaryResult", count_: "42" },
    { TableName: "PrimaryResult", count_: "None" },
  ]));
  const rows = await AzTasks.logAnalyticsQuery((q) =>
    q.workspace("ws").analyticsQuery("AppRequests | count").timespan("30m")
      .workspaces("ws2").runner(fake.run)
  );
  assertEquals(rows, [
    { TableName: "PrimaryResult", count_: "42" },
    { TableName: "PrimaryResult", count_: "None" },
  ]);
  assertEquals(fake.calls[0], [
    "az",
    "monitor",
    "log-analytics",
    "query",
    "--workspace=ws",
    "--analytics-query=AppRequests | count",
    "--timespan=PT1800S",
    "--workspaces",
    "ws2",
    "--output=json",
    "--query=@",
  ]);
});

Deno.test("logAnalyticsQuery takes an ISO timespan as written", async () => {
  const fake = new FakeAz("[]");
  for (const span of ["P1D", "2026-10-07T10:00:00Z/2026-10-07T11:00:00Z"]) {
    await AzTasks.logAnalyticsQuery((q) =>
      q.workspace("ws").analyticsQuery("T").timespan(span).runner(fake.run)
    );
  }
  assertEquals(fake.flag(0, "--timespan"), "P1D");
  assertEquals(
    fake.flag(1, "--timespan"),
    "2026-10-07T10:00:00Z/2026-10-07T11:00:00Z",
  );
});

Deno.test("logAnalyticsQuery refuses an answer of the wrong shape", async () => {
  const shapes = [
    ["{}", "not a list of rows"],
    ["[1]", "not an object"],
    ['[{"n": 1}]', "not a string"],
  ];
  for (const [answer, message] of shapes) {
    await assertRejects(
      () =>
        AzTasks.logAnalyticsQuery((q) =>
          q.workspace("w").analyticsQuery("q").runner(new FakeAz(answer).run)
        ),
      AzOutputError,
      message,
    );
  }
});

Deno.test("the log-analytics settings refuse a missing workspace or query", async () => {
  // Built through the reader's settings, refused before anything runs.
  await assertRejects(
    () => AzTasks.logAnalyticsQuery((q) => q.analyticsQuery("q")),
    Error,
    "no workspace",
  );
  await assertRejects(
    () => AzTasks.logAnalyticsQuery((q) => q.workspace("w")),
    Error,
    "no query",
  );
});

Deno.test("a reader without a lambda spawns az", async () => {
  await withEmptyPath(async () => {
    await assertRejects(() => AzTasks.subscriptionId(), Error, "az");
  });
});
