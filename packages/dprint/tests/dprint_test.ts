// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  DprintCheckSettings,
  DprintFmtSettings,
  DprintTasks,
} from "../src/dprint.ts";

Deno.test("the default binary and subcommands are dprint fmt/check", () => {
  assertEquals(new DprintFmtSettings().argv(), ["dprint", "fmt"]);
  assertEquals(new DprintCheckSettings().argv(), ["dprint", "check"]);
});

Deno.test("dprint fmt: every option renders, files last", () => {
  const argv = new DprintFmtSettings()
    .config("dprint.json").excludes("**/*.md", "vendor/**").incremental()
    .allowNoFiles().files("src", "mod.ts").argv();
  assertEquals(argv, [
    "dprint",
    "fmt",
    "-c",
    "dprint.json",
    "--excludes",
    "**/*.md",
    "--excludes",
    "vendor/**",
    "--incremental",
    "--allow-no-files",
    "src",
    "mod.ts",
  ]);
});

Deno.test("dprint check: minimal checks everything", () => {
  assertEquals(new DprintCheckSettings().argv(), ["dprint", "check"]);
});

Deno.test("dprint: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new DprintFmtSettings(), "dprint", {
    resolution: "node_modules",
  });
});

Deno.test("DprintTasks.fmt and .check reach execution", async () => {
  await assertRejects(() => DprintTasks.fmt(missingTool), ToolNotFoundError);
  await assertRejects(() => DprintTasks.check(missingTool), ToolNotFoundError);
});
