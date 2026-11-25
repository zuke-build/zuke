// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { RuntimeTasks } from "@zuke/core";
import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../../tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { AwsSettings, AwsTasks } from "../mod.ts";
import { FakeAws } from "../../../tests/support/aws/_fake.ts";
import { EVAL } from "../../../tests/_eval.ts";

test("the default binary is aws", () => {
  assertEquals(new AwsSettings().argv(), ["aws"]);
});

test("aws: command, global options, then extra flags", () => {
  const argv = new AwsSettings()
    .command("sns", "publish")
    .profile("deploy").region("eu-west-1").output("json")
    .query("MessageId").endpointUrl("http://localhost:4566")
    .noCliPager().noVerifySsl().noSignRequest().caBundle("ca.pem")
    .cliReadTimeout(30).cliConnectTimeout(5).debug()
    .flag("topic-arn", "arn:aws:sns:eu-west-1:1:t").flag("dry")
    .args("--extra")
    .argv();
  assertEquals(argv, [
    "aws",
    "sns",
    "publish",
    "--profile",
    "deploy",
    "--region",
    "eu-west-1",
    "--output",
    "json",
    "--query",
    "MessageId",
    "--endpoint-url",
    "http://localhost:4566",
    "--no-cli-pager",
    "--no-verify-ssl",
    "--no-sign-request",
    "--ca-bundle",
    "ca.pem",
    "--cli-read-timeout",
    "30",
    "--cli-connect-timeout",
    "5",
    "--debug",
    "--topic-arn",
    "arn:aws:sns:eu-west-1:1:t",
    "--dry",
    "--extra",
  ]);
});

test("aws: a minimal command carries no global options", () => {
  assertEquals(new AwsSettings().command("s3", "ls").argv(), [
    "aws",
    "s3",
    "ls",
  ]);
});

test("aws: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new AwsSettings().command("sts", "get-caller-identity"),
    "aws",
    { resolution: "path" },
  );
});

test("AwsTasks.run reaches execution", async () => {
  await assertRejects(
    () => AwsTasks.run((s) => missingTool(s.command("s3", "ls"))),
    ToolNotFoundError,
  );
});

test("the pager is switched off in the child's environment", async () => {
  // A real subprocess, but the running deno rather than aws: the settings
  // carry the environment, so whatever they spawn sees it.
  const output = await new AwsSettings()
    .toolPath(RuntimeTasks.execPath())
    .command(EVAL, "console.log(JSON.stringify(process.env['AWS_PAGER']))")
    .quiet()
    .run();
  assertEquals(output.stdout.trim(), '""');
});

test("a runner replaces the spawn and sees the full argv", async () => {
  const fake = new FakeAws("ok\n");
  const output = await AwsTasks.run((s) =>
    s.command("s3", "ls").region("us-east-1").runner(fake.run)
  );
  assertEquals(output.stdout, "ok\n");
  assertEquals(fake.calls, [["aws", "s3", "ls", "--region", "us-east-1"]]);
});

test("a runner's failed exit throws a CommandError", async () => {
  const fake = new FakeAws(new CommandOutput(254, "", "AccessDenied"));
  const error = await assertRejects(
    () => AwsTasks.run((s) => s.command("s3", "ls").runner(fake.run)),
    CommandError,
  );
  assertStringIncludes(error.message, "exit 254");
  assertStringIncludes(error.message, "aws s3 ls");
  assertStringIncludes(error.message, "AccessDenied");
});

test("a runner's failed exit is returned under noThrow", async () => {
  const fake = new FakeAws(new CommandOutput(1, "", "nope"));
  const output = await AwsTasks.run((s) =>
    s.command("s3", "ls").noThrow().runner(fake.run)
  );
  assertEquals(output.code, 1);
});
