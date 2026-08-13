// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { OrvalGenerateSettings, OrvalTasks } from "../src/orval.ts";

Deno.test("the default binary is orval", () => {
  assertEquals(new OrvalGenerateSettings().argv(), ["orval"]);
});

Deno.test("generate: every option renders, in order", () => {
  const argv = new OrvalGenerateSettings()
    .config("orval.config.ts").project("petstore").input("openapi.yaml")
    .output("src/api").watch().clean().prettier().biome().mock().argv();
  assertEquals(argv, [
    "orval",
    "--config",
    "orval.config.ts",
    "--project",
    "petstore",
    "--input",
    "openapi.yaml",
    "--output",
    "src/api",
    "--watch",
    "--clean",
    "--prettier",
    "--biome",
    "--mock",
  ]);
});

Deno.test("generate: minimal uses just the config", () => {
  assertEquals(new OrvalGenerateSettings().config("orval.config.ts").argv(), [
    "orval",
    "--config",
    "orval.config.ts",
  ]);
});

Deno.test("OrvalTasks.generate reaches execution", async () => {
  await assertRejects(
    () => OrvalTasks.generate(missingTool),
    ToolNotFoundError,
  );
});

Deno.test("orval: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new OrvalGenerateSettings(), "orval", {
    resolution: "node_modules",
  });
});
