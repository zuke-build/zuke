// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  BiomeCheckSettings,
  BiomeCiSettings,
  BiomeFormatSettings,
  BiomeLintSettings,
  BiomeTasks,
} from "../src/biome.ts";

Deno.test("the default binary is biome", () => {
  assertEquals(new BiomeCheckSettings().argv()[0], "biome");
});

Deno.test("shared filters: config, reporter, --staged, --changed, paths", () => {
  assertEquals(
    new BiomeCiSettings()
      .config("biome.json")
      .reporter("github")
      .staged()
      .changed()
      .paths("src", "test")
      .argv()
      .slice(1),
    [
      "ci",
      "--config-path=biome.json",
      "--reporter=github",
      "--staged",
      "--changed",
      "src",
      "test",
    ],
  );
});

Deno.test("check: bare, --write, --unsafe with paths", () => {
  assertEquals(new BiomeCheckSettings().argv().slice(1), ["check"]);
  assertEquals(
    new BiomeCheckSettings().write().unsafe().paths("src").argv().slice(1),
    ["check", "--write", "--unsafe", "src"],
  );
});

Deno.test("format: --write with paths", () => {
  assertEquals(
    new BiomeFormatSettings().write().paths("src").argv().slice(1),
    ["format", "--write", "src"],
  );
});

Deno.test("lint: --write, --unsafe with paths", () => {
  assertEquals(
    new BiomeLintSettings().write().unsafe().paths("src").argv().slice(1),
    ["lint", "--write", "--unsafe", "src"],
  );
});

Deno.test("ci: bare", () => {
  assertEquals(new BiomeCiSettings().argv().slice(1), ["ci"]);
});

Deno.test("biome: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new BiomeCheckSettings(), "biome", {
    resolution: "node_modules",
  });
});

Deno.test("every BiomeTasks function reaches execution", async () => {
  await assertRejects(() => BiomeTasks.check(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.format(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.lint(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.ci(missingTool), ToolNotFoundError);
});
