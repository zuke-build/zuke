// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { GhSettings, GhTasks } from "../src/gh.ts";

test("the default binary is gh", () => {
  assertEquals(new GhSettings().argv(), ["gh"]);
});

test("gh: command, repo, then flags", () => {
  const argv = new GhSettings()
    .command("release", "create", "v1.2.3")
    .repo("acme/app")
    .flag("title", "v1.2.3")
    .flag("generate-notes")
    .argv();
  assertEquals(argv, [
    "gh",
    "release",
    "create",
    "v1.2.3",
    "--repo",
    "acme/app",
    "--title",
    "v1.2.3",
    "--generate-notes",
  ]);
});

test("gh: minimal runs just the command", () => {
  assertEquals(new GhSettings().command("pr", "list").argv(), [
    "gh",
    "pr",
    "list",
  ]);
});

test("GhTasks.run reaches execution", async () => {
  await assertRejects(
    () => GhTasks.run((s) => missingTool(s.command("auth", "status"))),
    ToolNotFoundError,
  );
});
