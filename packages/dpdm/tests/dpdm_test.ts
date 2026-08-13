// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { DpdmAnalyzeSettings, DpdmTasks } from "../src/dpdm.ts";

Deno.test("the default binary is dpdm", () => {
  assertEquals(new DpdmAnalyzeSettings().argv()[0], "dpdm");
});

Deno.test("analyze: bare is empty argv", () => {
  assertEquals(new DpdmAnalyzeSettings().argv().slice(1), []);
});

Deno.test("analyze: entries are appended after the flags", () => {
  assertEquals(
    new DpdmAnalyzeSettings()
      .noTree()
      .entries("src/index.ts", "src/cli.ts")
      .argv()
      .slice(1),
    ["--no-tree", "src/index.ts", "src/cli.ts"],
  );
});

Deno.test("analyze: all options render in order", () => {
  assertEquals(
    new DpdmAnalyzeSettings()
      .transform()
      .noTree()
      .noCircular()
      .noWarning()
      .noProgress()
      .output("deps.json")
      .tsconfig("tsconfig.json")
      .context("src")
      .extensions(".ts", ".tsx")
      .js(".mjs", ".js")
      .include("\\.ts$")
      .exclude("node_modules")
      .skipDynamicImports("circular")
      .detectUnusedFilesFrom("src/**/*")
      .exitCode("circular:1")
      .entries("src/index.ts")
      .argv()
      .slice(1),
    [
      "--transform",
      "--no-tree",
      "--no-circular",
      "--no-warning",
      "--no-progress",
      "--output",
      "deps.json",
      "--tsconfig",
      "tsconfig.json",
      "--context",
      "src",
      "--extensions",
      ".ts,.tsx",
      "--js",
      ".mjs,.js",
      "--include",
      "\\.ts$",
      "--exclude",
      "node_modules",
      "--skip-dynamic-imports",
      "circular",
      "--detect-unused-files-from",
      "src/**/*",
      "--exit-code",
      "circular:1",
      "src/index.ts",
    ],
  );
});

Deno.test("DpdmTasks.analyze reaches execution", async () => {
  await assertRejects(() => DpdmTasks.analyze(missingTool), ToolNotFoundError);
});

Deno.test("dpdm: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new DpdmAnalyzeSettings(), "dpdm", {
    resolution: "node_modules",
  });
});
