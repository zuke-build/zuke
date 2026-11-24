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
  TsdownBuildSettings,
  TsdownMigrateSettings,
  TsdownTasks,
} from "../src/tsdown.ts";

test("the default binary is tsdown (build)", () => {
  assertEquals(new TsdownBuildSettings().argv(), ["tsdown"]);
});

test("the default binary is tsdown (migrate)", () => {
  assertEquals(new TsdownMigrateSettings().argv(), ["tsdown", "migrate"]);
});

test("build: every option renders", () => {
  assertEquals(
    new TsdownBuildSettings()
      .entry("src/index.ts", "src/cli.ts")
      .format("esm", "cjs")
      .dts()
      .minify()
      .sourcemap()
      .clean()
      .watch()
      .outDir("dist")
      .target("es2022")
      .tsconfig("tsconfig.build.json")
      .config("tsdown.config.ts")
      .platform("node")
      .treeshake()
      .argv()
      .slice(1),
    [
      "src/index.ts",
      "src/cli.ts",
      "--format",
      "esm,cjs",
      "--dts",
      "--minify",
      "--sourcemap",
      "--clean",
      "--watch",
      "--out-dir",
      "dist",
      "--target",
      "es2022",
      "--tsconfig",
      "tsconfig.build.json",
      "--config",
      "tsdown.config.ts",
      "--platform",
      "node",
      "--treeshake",
    ],
  );
});

test("build: entry-only is minimal argv", () => {
  assertEquals(
    new TsdownBuildSettings().entry("src/index.ts").argv().slice(1),
    ["src/index.ts"],
  );
});

test("migrate: every option renders", () => {
  assertEquals(
    new TsdownMigrateSettings()
      .from("tsup")
      .dryRun()
      .argv()
      .slice(1),
    ["migrate", "--from", "tsup", "--dry-run"],
  );
});

test("TsdownTasks.build reaches execution", async () => {
  await assertRejects(() => TsdownTasks.build(missingTool), ToolNotFoundError);
});

test("TsdownTasks.migrate reaches execution", async () => {
  await assertRejects(
    () => TsdownTasks.migrate(missingTool),
    ToolNotFoundError,
  );
});

test("tsdown: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new TsdownBuildSettings(), "tsdown", {
    resolution: "node_modules",
  });
});
