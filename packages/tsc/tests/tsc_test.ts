// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { TscBuildSettings, TscSettings, TscTasks } from "../src/tsc.ts";

test("the default binary is tsc", () => {
  assertEquals(new TscSettings().argv(), ["tsc"]);
  assertEquals(new TscBuildSettings().argv(), ["tsc", "--build"]);
});

test("tsc: every option renders, paths last", () => {
  const argv = new TscSettings()
    .project("tsconfig.json").noEmit().outDir("dist").declaration()
    .emitDeclarationOnly().incremental().watch().strict().pretty()
    .listFiles().skipLibCheck().noEmitOnError().target("es2022")
    .module("nodenext").paths("a.ts", "b.ts").argv();
  assertEquals(argv, [
    "tsc",
    "-p",
    "tsconfig.json",
    "--noEmit",
    "--outDir",
    "dist",
    "--declaration",
    "--emitDeclarationOnly",
    "--incremental",
    "--watch",
    "--strict",
    "--pretty",
    "--listFiles",
    "--skipLibCheck",
    "--noEmitOnError",
    "--target",
    "es2022",
    "--module",
    "nodenext",
    "a.ts",
    "b.ts",
  ]);
});

test("tsc: minimal checks the given file", () => {
  assertEquals(new TscSettings().paths("mod.ts").argv(), ["tsc", "mod.ts"]);
});

test("build: every option renders, projects last", () => {
  const argv = new TscBuildSettings()
    .noEmit().clean().force().dry().watch().verbose().incremental()
    .projects("packages/a", "packages/b").argv();
  assertEquals(argv, [
    "tsc",
    "--build",
    "--noEmit",
    "--clean",
    "--force",
    "--dry",
    "--watch",
    "--verbose",
    "--incremental",
    "packages/a",
    "packages/b",
  ]);
});

test("TscTasks.tsc reaches execution", async () => {
  await assertRejects(() => TscTasks.tsc(missingTool), ToolNotFoundError);
});

test("TscTasks.build reaches execution", async () => {
  await assertRejects(() => TscTasks.build(missingTool), ToolNotFoundError);
});

test("tsc: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new TscSettings(), "tsc", {
    resolution: "node_modules",
  });
});
