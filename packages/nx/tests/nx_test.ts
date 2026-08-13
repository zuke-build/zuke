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
  NxAffectedSettings,
  NxRunManySettings,
  NxRunSettings,
  NxTasks,
} from "../src/nx.ts";

Deno.test("the default binary is nx", () => {
  assertEquals(new NxRunSettings().target("web:build").argv()[0], "nx");
});

Deno.test("nx: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new NxRunSettings().target("web:build"),
    "nx",
    {
      resolution: "node_modules",
    },
  );
});

Deno.test("run: requires a target; configuration", () => {
  assertThrows(
    () => new NxRunSettings().argv(),
    Error,
    "NxTasks.run: .target() is required",
  );
  assertEquals(new NxRunSettings().target("web:build").argv().slice(1), [
    "run",
    "web:build",
  ]);
  assertEquals(
    new NxRunSettings().target("web:build").configuration("production").argv()
      .slice(1),
    ["run", "web:build", "--configuration=production"],
  );
});

Deno.test("runMany: requires a target; projects, configuration, parallel, all", () => {
  assertThrows(
    () => new NxRunManySettings().argv(),
    Error,
    "NxTasks.runMany: .target() is required",
  );
  assertEquals(new NxRunManySettings().target("build").argv().slice(1), [
    "run-many",
    "--target=build",
  ]);
  assertEquals(
    new NxRunManySettings()
      .target("build")
      .projects("web", "api")
      .configuration("ci")
      .parallel(3)
      .all()
      .argv()
      .slice(1),
    [
      "run-many",
      "--target=build",
      "--projects=web,api",
      "--configuration=ci",
      "--parallel=3",
      "--all",
    ],
  );
});

Deno.test("affected: requires a target; base, head, configuration, parallel", () => {
  assertThrows(
    () => new NxAffectedSettings().argv(),
    Error,
    "NxTasks.affected: .target() is required",
  );
  assertEquals(
    new NxAffectedSettings()
      .target("test")
      .base("main")
      .head("HEAD")
      .configuration("ci")
      .parallel(2)
      .argv()
      .slice(1),
    [
      "affected",
      "--target=test",
      "--base=main",
      "--head=HEAD",
      "--configuration=ci",
      "--parallel=2",
    ],
  );
});

Deno.test("every NxTasks function reaches execution", async () => {
  await assertRejects(
    () => NxTasks.run((s) => missingTool(s).target("web:build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NxTasks.runMany((s) => missingTool(s).target("build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NxTasks.affected((s) => missingTool(s).target("test")),
    ToolNotFoundError,
  );
});
