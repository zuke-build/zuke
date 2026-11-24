// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
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

test("the default binary is biome", () => {
  assertEquals(new BiomeCheckSettings().argv()[0], "biome");
});

test("shared filters: config, reporter, --staged, --changed, paths", () => {
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

test("check: bare, --write, --unsafe with paths", () => {
  assertEquals(new BiomeCheckSettings().argv().slice(1), ["check"]);
  assertEquals(
    new BiomeCheckSettings().write().unsafe().paths("src").argv().slice(1),
    ["check", "--write", "--unsafe", "src"],
  );
});

test("format: --write with paths", () => {
  assertEquals(
    new BiomeFormatSettings().write().paths("src").argv().slice(1),
    ["format", "--write", "src"],
  );
});

test("lint: --write, --unsafe with paths", () => {
  assertEquals(
    new BiomeLintSettings().write().unsafe().paths("src").argv().slice(1),
    ["lint", "--write", "--unsafe", "src"],
  );
});

test("ci: bare", () => {
  assertEquals(new BiomeCiSettings().argv().slice(1), ["ci"]);
});

test("biome: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new BiomeCheckSettings(), "biome", {
    resolution: "node_modules",
  });
});

test("every BiomeTasks function reaches execution", async () => {
  await assertRejects(() => BiomeTasks.check(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.format(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.lint(missingTool), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.ci(missingTool), ToolNotFoundError);
});
