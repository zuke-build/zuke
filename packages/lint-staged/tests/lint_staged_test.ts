// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { LintStagedSettings, LintStagedTasks } from "../src/lint_staged.ts";

Deno.test("the default invocation is a bare lint-staged", () => {
  assertEquals(new LintStagedSettings().argv(), ["lint-staged"]);
});

Deno.test("lint-staged: every option renders", () => {
  const argv = new LintStagedSettings()
    .config(".lintstagedrc.json").relative().concurrent(1).allowEmpty()
    .diff("main...HEAD").shell().argv();
  assertEquals(argv, [
    "lint-staged",
    "--config",
    ".lintstagedrc.json",
    "--relative",
    "--concurrent",
    "1",
    "--allow-empty",
    "--diff",
    "main...HEAD",
    "--shell",
  ]);
});

Deno.test("LintStagedTasks.run reaches execution", async () => {
  await assertRejects(
    () => LintStagedTasks.run(missingTool),
    ToolNotFoundError,
  );
});

Deno.test("lint-staged: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new LintStagedSettings(),
    "lint-staged",
    {
      resolution: "node_modules",
    },
  );
});
