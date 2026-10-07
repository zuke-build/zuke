// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { type AzOutputFormat, AzSettings, AzTasks } from "../mod.ts";
import { FakeAz } from "./_fake.ts";

Deno.test("the default binary is az", () => {
  assertEquals(new AzSettings().argv(), ["az"]);
});

Deno.test("az: command, global options, then extra flags", () => {
  const argv = new AzSettings()
    .command("network", "front-door", "purge")
    .subscription("prod").output("jsonc").query("[].name")
    .onlyShowErrors().verbose().debug()
    .flag("resource-group", "rg").flag("no-wait")
    .args("--extra")
    .argv();
  assertEquals(argv, [
    "az",
    "network",
    "front-door",
    "purge",
    "--subscription=prod",
    "--output=jsonc",
    "--query=[].name",
    "--only-show-errors",
    "--verbose",
    "--debug",
    "--resource-group",
    "rg",
    "--no-wait",
    "--extra",
  ]);
});

Deno.test("az: a minimal command carries no global options", () => {
  assertEquals(new AzSettings().command("group", "list").argv(), [
    "az",
    "group",
    "list",
  ]);
});

Deno.test("az: every output format is typed", () => {
  const formats: AzOutputFormat[] = [
    "json",
    "jsonc",
    "yaml",
    "yamlc",
    "table",
    "tsv",
    "none",
  ];
  for (const format of formats) {
    assertEquals(new AzSettings().output(format).argv(), [
      "az",
      `--output=${format}`,
    ]);
  }
});

Deno.test("az: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new AzSettings().command("account", "show"),
    "az",
    { resolution: "path" },
  );
});

Deno.test("AzTasks.run reaches execution", async () => {
  await assertRejects(
    () => AzTasks.run((s) => missingTool(s.command("account", "show"))),
    ToolNotFoundError,
  );
});

Deno.test("prompts, extension installs and colour are off in the child's environment", async () => {
  // A real subprocess, but the running deno rather than az: the settings
  // carry the environment, so whatever they spawn sees it.
  const output = await new AzSettings()
    .toolPath(Deno.execPath())
    .command(
      "eval",
      "console.log(JSON.stringify(['AZURE_EXTENSION_USE_DYNAMIC_INSTALL', " +
        "'AZURE_CORE_LOGIN_EXPERIENCE_V2', 'AZURE_CORE_NO_COLOR']" +
        ".map((n) => Deno.env.get(n))))",
    )
    .quiet()
    .run();
  assertEquals(JSON.parse(output.stdout), ["no", "off", "true"]);
});

Deno.test("the environment defaults can be overridden", async () => {
  const output = await new AzSettings()
    .env({ AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt" })
    .toolPath(Deno.execPath())
    .command(
      "eval",
      "console.log(Deno.env.get('AZURE_EXTENSION_USE_DYNAMIC_INSTALL'))",
    )
    .quiet()
    .run();
  assertEquals(output.stdout.trim(), "yes_without_prompt");
});

Deno.test("a runner replaces the spawn and sees the full argv", async () => {
  const fake = new FakeAz("ok\n");
  const output = await AzTasks.run((s) =>
    s.command("group", "list").subscription("dev").runner(fake.run)
  );
  assertEquals(output.stdout, "ok\n");
  assertEquals(fake.calls, [["az", "group", "list", "--subscription=dev"]]);
});

Deno.test("a runner's failed exit throws a CommandError", async () => {
  const fake = new FakeAz(new CommandOutput(3, "", "AuthorizationFailed"));
  const error = await assertRejects(
    () => AzTasks.run((s) => s.command("group", "list").runner(fake.run)),
    CommandError,
  );
  assertStringIncludes(error.message, "exit 3");
  assertStringIncludes(error.message, "az group list");
  assertStringIncludes(error.message, "AuthorizationFailed");
});

Deno.test("a runner's failed exit is returned under noThrow", async () => {
  const fake = new FakeAz(new CommandOutput(1, "", "nope"));
  const output = await AzTasks.run((s) =>
    s.command("group", "list").noThrow().runner(fake.run)
  );
  assertEquals(output.code, 1);
});
