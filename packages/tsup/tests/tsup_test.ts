// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { TsupBuildSettings, TsupTasks } from "../src/tsup.ts";

test("the default binary is tsup", () => {
  assertEquals(new TsupBuildSettings().argv()[0], "tsup");
});

test("build: bare is empty argv", () => {
  assertEquals(new TsupBuildSettings().argv().slice(1), []);
});

test("build: entries first, then flags; formats joined", () => {
  assertEquals(
    new TsupBuildSettings()
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
      .config("tsup.config.ts")
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
      "tsup.config.ts",
    ],
  );
});

test("TsupTasks.build reaches execution", async () => {
  await assertRejects(() => TsupTasks.build(missingTool), ToolNotFoundError);
});

test("tsup: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new TsupBuildSettings(), "tsup", {
    resolution: "node_modules",
  });
});
