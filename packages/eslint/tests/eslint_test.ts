// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { EslintSettings, EslintTasks } from "../src/eslint.ts";

Deno.test("the default binary is eslint", () => {
  assertEquals(new EslintSettings().argv(), ["eslint"]);
});

Deno.test("eslint: every option renders, paths last", () => {
  const argv = new EslintSettings()
    .config("eslint.config.js").ext(".ts", ".tsx").fix().fixDryRun()
    .fixType("problem", "suggestion").quietWarnings().maxWarnings(0)
    .format("json").outputFile("report.json").cache()
    .cacheLocation(".eslintcache").ignorePath(".eslintignore")
    .ignorePattern("dist/**").noIgnore().noConfigLookup()
    .reportUnusedDisableDirectives().paths("src", "test").argv();
  assertEquals(argv, [
    "eslint",
    "-c",
    "eslint.config.js",
    "--ext",
    ".ts",
    "--ext",
    ".tsx",
    "--fix",
    "--fix-dry-run",
    "--fix-type",
    "problem",
    "--fix-type",
    "suggestion",
    "--quiet",
    "--max-warnings",
    "0",
    "-f",
    "json",
    "-o",
    "report.json",
    "--cache",
    "--cache-location",
    ".eslintcache",
    "--ignore-path",
    ".eslintignore",
    "--ignore-pattern",
    "dist/**",
    "--no-ignore",
    "--no-config-lookup",
    "--report-unused-disable-directives",
    "src",
    "test",
  ]);
});

Deno.test("eslint: minimal lints just the given path", () => {
  assertEquals(new EslintSettings().paths("src").argv(), ["eslint", "src"]);
});

Deno.test("EslintTasks.lint reaches execution", async () => {
  await assertRejects(() => EslintTasks.lint(missingTool), ToolNotFoundError);
});

Deno.test("eslint: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new EslintSettings(), "eslint", {
    resolution: "node_modules",
  });
});
