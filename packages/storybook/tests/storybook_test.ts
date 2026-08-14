// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  StorybookBuildSettings,
  StorybookDevSettings,
  StorybookTasks,
} from "../src/storybook.ts";

Deno.test("storybook dev: the default invocation is the bare subcommand", () => {
  assertEquals(new StorybookDevSettings().argv(), ["storybook", "dev"]);
});

Deno.test("storybook dev: every option renders", () => {
  const argv = new StorybookDevSettings()
    .configDir(".storybook").port(6006).host("0.0.0.0").noOpen().ci().argv();
  assertEquals(argv, [
    "storybook",
    "dev",
    "--config-dir",
    ".storybook",
    "--port",
    "6006",
    "--host",
    "0.0.0.0",
    "--no-open",
    "--ci",
  ]);
});

Deno.test("storybook build: every option renders", () => {
  const argv = new StorybookBuildSettings()
    .configDir("config/storybook").outputDir("storybook-static").quietOutput()
    .argv();
  assertEquals(argv, [
    "storybook",
    "build",
    "--config-dir",
    "config/storybook",
    "--output-dir",
    "storybook-static",
    "--quiet",
  ]);
});

Deno.test("storybook build: the default invocation is the bare subcommand", () => {
  assertEquals(new StorybookBuildSettings().argv(), ["storybook", "build"]);
});

Deno.test("StorybookTasks reach execution", async () => {
  await assertRejects(() => StorybookTasks.dev(missingTool), ToolNotFoundError);
  await assertRejects(
    () => StorybookTasks.build(missingTool),
    ToolNotFoundError,
  );
});

Deno.test("storybook: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new StorybookDevSettings(),
    "storybook",
    {
      resolution: "node_modules",
    },
  );
});
