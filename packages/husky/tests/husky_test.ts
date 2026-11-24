// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  HuskyInitSettings,
  HuskyInstallSettings,
  HuskyTasks,
} from "../src/husky.ts";

test("the default binary is husky and the bare install emits just husky", () => {
  assertEquals(new HuskyInstallSettings().argv(), ["husky"]);
  assertEquals(new HuskyInitSettings().argv(), ["husky", "init"]);
});

test("init with dir renders the positional directory", () => {
  assertEquals(
    new HuskyInitSettings().dir(".husky").argv(),
    ["husky", "init", ".husky"],
  );
});

test("install with dir renders the positional directory", () => {
  assertEquals(
    new HuskyInstallSettings().dir(".husky").argv(),
    ["husky", ".husky"],
  );
});

test("HuskyTasks.init reaches execution", async () => {
  await assertRejects(() => HuskyTasks.init(missingTool), ToolNotFoundError);
});

test("HuskyTasks.install reaches execution", async () => {
  await assertRejects(() => HuskyTasks.install(missingTool), ToolNotFoundError);
});

test("husky: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new HuskyInstallSettings(), "husky", {
    resolution: "node_modules",
  });
});
