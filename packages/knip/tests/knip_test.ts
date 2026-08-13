// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { KnipRunSettings, KnipTasks } from "../src/knip.ts";

Deno.test("the default binary is knip", () => {
  assertEquals(new KnipRunSettings().argv()[0], "knip");
});

Deno.test("run: bare is empty argv", () => {
  assertEquals(new KnipRunSettings().argv().slice(1), []);
});

Deno.test("run: all options render", () => {
  assertEquals(
    new KnipRunSettings()
      .production()
      .strict()
      .fix()
      .cache()
      .noExitCode()
      .config("knip.json")
      .workspace("packages/web")
      .reporter("compact")
      .include("files", "dependencies")
      .argv()
      .slice(1),
    [
      "--production",
      "--strict",
      "--fix",
      "--cache",
      "--no-exit-code",
      "--config",
      "knip.json",
      "--workspace",
      "packages/web",
      "--reporter",
      "compact",
      "--include",
      "files,dependencies",
    ],
  );
});

Deno.test("KnipTasks.run reaches execution", async () => {
  await assertRejects(() => KnipTasks.run(missingTool), ToolNotFoundError);
});

Deno.test("knip: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new KnipRunSettings(), "knip", {
    resolution: "node_modules",
  });
});
