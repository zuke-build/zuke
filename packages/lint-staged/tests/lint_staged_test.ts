// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { LintStagedSettings, LintStagedTasks } from "../src/lint_staged.ts";

test("the default invocation is a bare lint-staged", () => {
  assertEquals(new LintStagedSettings().argv(), ["lint-staged"]);
});

test("lint-staged: every option renders", () => {
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

test("LintStagedTasks.run reaches execution", async () => {
  await assertRejects(
    () => LintStagedTasks.run(missingTool),
    ToolNotFoundError,
  );
});

test("lint-staged: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new LintStagedSettings(),
    "lint-staged",
    {
      resolution: "node_modules",
    },
  );
});
