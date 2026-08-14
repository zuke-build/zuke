// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  RedoclyBundleSettings,
  RedoclyLintSettings,
  RedoclySplitSettings,
  RedoclyTasks,
} from "../src/redocly.ts";

Deno.test("redocly lint: the default invocation is the bare subcommand", () => {
  assertEquals(new RedoclyLintSettings().argv(), ["redocly", "lint"]);
});

Deno.test("redocly lint: every option renders, descriptions last", () => {
  const argv = new RedoclyLintSettings()
    .config("redocly.yaml")
    .skipRule("no-empty-servers", "operation-4xx-response")
    .format("summary")
    .paths("openapi.yaml", "admin-api.yaml")
    .argv();
  assertEquals(argv, [
    "redocly",
    "lint",
    "--config",
    "redocly.yaml",
    "--skip-rule",
    "no-empty-servers",
    "--skip-rule",
    "operation-4xx-response",
    "--format",
    "summary",
    "openapi.yaml",
    "admin-api.yaml",
  ]);
});

Deno.test("redocly bundle: every option renders, descriptions last", () => {
  const argv = new RedoclyBundleSettings()
    .config("redocly.yaml").output("dist/openapi.yaml").dereferenced()
    .ext("yaml").paths("openapi.yaml").argv();
  assertEquals(argv, [
    "redocly",
    "bundle",
    "--config",
    "redocly.yaml",
    "--output",
    "dist/openapi.yaml",
    "--dereferenced",
    "--ext",
    "yaml",
    "openapi.yaml",
  ]);
});

Deno.test("redocly split: the description is positional, the target directory a flag", () => {
  const argv = new RedoclySplitSettings()
    .api("openapi.yaml").outDir("docs/api").separator("_").argv();
  assertEquals(argv, [
    "redocly",
    "split",
    "openapi.yaml",
    "--outDir",
    "docs/api",
    "--separator",
    "_",
  ]);
});

Deno.test("redocly split: both required arguments are enforced", () => {
  assertThrows(
    () => new RedoclySplitSettings().outDir("docs/api").argv(),
    Error,
    ".api() is required",
  );
  assertThrows(
    () => new RedoclySplitSettings().api("openapi.yaml").argv(),
    Error,
    ".outDir() is required",
  );
});

Deno.test("RedoclyTasks reach execution", async () => {
  await assertRejects(() => RedoclyTasks.lint(missingTool), ToolNotFoundError);
  await assertRejects(
    () => RedoclyTasks.bundle(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => RedoclyTasks.split((s) => missingTool(s.api("a.yaml").outDir("d"))),
    ToolNotFoundError,
  );
});

Deno.test("redocly: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new RedoclyLintSettings(), "redocly", {
    resolution: "node_modules",
  });
});
