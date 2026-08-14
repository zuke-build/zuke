// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { CspellSettings, CspellTasks } from "../src/cspell.ts";

Deno.test("the default invocation is cspell lint", () => {
  assertEquals(new CspellSettings().argv(), ["cspell", "lint"]);
});

Deno.test("cspell: every option renders, files last", () => {
  const argv = new CspellSettings()
    .config("cspell.json").noProgress().noSummary().showSuggestions()
    .showContext().quietOutput().cache().dot().gitignore()
    .gitignoreRoot(".").noMustFindFiles().unique()
    .locale("en,en-GB").exclude("dist/**").exclude("vendor/**")
    .maxDuplicateProblems(5).files("**", "docs/**").argv();
  assertEquals(argv, [
    "cspell",
    "lint",
    "-c",
    "cspell.json",
    "--no-progress",
    "--no-summary",
    "--show-suggestions",
    "--show-context",
    "--quiet",
    "--cache",
    "--dot",
    "--gitignore",
    "--gitignore-root",
    ".",
    "--no-must-find-files",
    "--unique",
    "--locale",
    "en,en-GB",
    "-e",
    "dist/**",
    "-e",
    "vendor/**",
    "--max-duplicate-problems",
    "5",
    "**",
    "docs/**",
  ]);
});

Deno.test("cspell: minimal checks just the given glob", () => {
  assertEquals(new CspellSettings().files("**").argv(), [
    "cspell",
    "lint",
    "**",
  ]);
});

Deno.test("CspellTasks.lint reaches execution", async () => {
  await assertRejects(() => CspellTasks.lint(missingTool), ToolNotFoundError);
});

Deno.test("cspell: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new CspellSettings(), "cspell", {
    resolution: "node_modules",
  });
});
