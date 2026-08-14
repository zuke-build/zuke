// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { GcloudSettings, GcloudTasks } from "../src/gcloud.ts";

Deno.test("the default binary is gcloud", () => {
  assertEquals(new GcloudSettings().argv(), ["gcloud"]);
});

Deno.test("gcloud: command, global flags, then extra flags", () => {
  const argv = new GcloudSettings()
    .command("run", "deploy", "api")
    .project("proj").account("me@example.com").configuration("default")
    .format("json").verbosity("info").noPrompt()
    .flag("region", "us-central1").flag("async")
    .argv();
  assertEquals(argv, [
    "gcloud",
    "run",
    "deploy",
    "api",
    "--project",
    "proj",
    "--account",
    "me@example.com",
    "--configuration",
    "default",
    "--format",
    "json",
    "--verbosity",
    "info",
    "--quiet",
    "--region",
    "us-central1",
    "--async",
  ]);
});

Deno.test("gcloud: minimal runs just the command", () => {
  assertEquals(new GcloudSettings().command("auth", "list").argv(), [
    "gcloud",
    "auth",
    "list",
  ]);
});

Deno.test("GcloudTasks.run reaches execution", async () => {
  await assertRejects(
    () => GcloudTasks.run((s) => missingTool(s.command("version"))),
    ToolNotFoundError,
  );
});

Deno.test("containerImagesAddTag tags across registries, quietly", () => {
  assertEquals(
    new GcloudSettings()
      .containerImagesAddTag("gcr.io/p/img:sha", "eu.gcr.io/p/img:prod")
      .argv(),
    [
      "gcloud",
      "container",
      "images",
      "add-tag",
      "gcr.io/p/img:sha",
      "eu.gcr.io/p/img:prod",
      "--quiet",
    ],
  );
});

Deno.test("containerImagesAddTag accepts multiple destination tags", () => {
  const argv = new GcloudSettings()
    .containerImagesAddTag("src:sha", "a:prod", "b:latest")
    .argv();
  assertEquals(argv.slice(1, 6), [
    "container",
    "images",
    "add-tag",
    "src:sha",
    "a:prod",
  ]);
  assertEquals(argv.includes("b:latest"), true);
});

Deno.test("sqlInstancesDescribe builds the describe command", () => {
  assertEquals(
    new GcloudSettings().sqlInstancesDescribe("prod-db").format("json").argv(),
    ["gcloud", "sql", "instances", "describe", "prod-db", "--format", "json"],
  );
});

Deno.test("sqlOperationsWait builds the wait command", () => {
  assertEquals(
    new GcloudSettings().sqlOperationsWait("op-123").project("p").argv(),
    ["gcloud", "sql", "operations", "wait", "op-123", "--project", "p"],
  );
});

Deno.test("gcloud: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new GcloudSettings().sqlInstancesDescribe("db"),
    "gcloud",
    {
      resolution: "path",
    },
  );
});
