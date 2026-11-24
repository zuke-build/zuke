// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
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
  TurboPruneSettings,
  TurboRunSettings,
  TurboTasks,
} from "../src/turbo.ts";

test("the default binary is turbo", () => {
  assertEquals(new TurboRunSettings().tasks("build").argv()[0], "turbo");
});

test("turbo: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new TurboRunSettings().tasks("build"),
    "turbo",
    {
      resolution: "node_modules",
    },
  );
});

test("run: requires a task; tasks first, then flags", () => {
  assertThrows(
    () => new TurboRunSettings().argv(),
    Error,
    "TurboTasks.run: .tasks(...) requires at least one task",
  );
  assertEquals(new TurboRunSettings().tasks("build").argv().slice(1), [
    "run",
    "build",
  ]);
  assertEquals(
    new TurboRunSettings()
      .tasks("build", "test")
      .filter("web")
      .filter("docs")
      .parallel()
      .concurrency("50%")
      .force()
      .noCache()
      .continue()
      .dryRun()
      .outputLogs("errors-only")
      .argv()
      .slice(1),
    [
      "run",
      "build",
      "test",
      "--filter=web",
      "--filter=docs",
      "--parallel",
      "--concurrency=50%",
      "--force",
      "--no-cache",
      "--continue",
      "--dry-run",
      "--output-logs=errors-only",
    ],
  );
});

test("prune: requires a package; --docker and --out-dir", () => {
  assertThrows(
    () => new TurboPruneSettings().argv(),
    Error,
    "TurboTasks.prune: .package() is required",
  );
  assertEquals(
    new TurboPruneSettings().package("web").docker().outDir("out").argv().slice(
      1,
    ),
    ["prune", "web", "--docker", "--out-dir=out"],
  );
});

test("every TurboTasks function reaches execution", async () => {
  await assertRejects(
    () => TurboTasks.run((s) => missingTool(s).tasks("build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TurboTasks.prune((s) => missingTool(s).package("web")),
    ToolNotFoundError,
  );
});
