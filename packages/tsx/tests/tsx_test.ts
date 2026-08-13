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
import { TsxSettings, TsxTasks, TsxWatchSettings } from "../src/tsx.ts";

Deno.test("the default binary is tsx", () => {
  assertEquals(new TsxSettings().script("main.ts").argv(), ["tsx", "main.ts"]);
});

Deno.test("tsx: every option renders, script and its args last", () => {
  const argv = new TsxSettings()
    .tsconfig("tsconfig.json").envFile(".env").noCache().noWarnings()
    .conditions("development", "browser").importModule("./reg.ts", "dotenv")
    .script("src/main.ts").scriptArgs("--port", 3000).argv();
  assertEquals(argv, [
    "tsx",
    "--tsconfig",
    "tsconfig.json",
    "--env-file=.env",
    "--no-cache",
    "--no-warnings",
    "--conditions",
    "development",
    "--conditions",
    "browser",
    "--import",
    "./reg.ts",
    "--import",
    "dotenv",
    "src/main.ts",
    "--port",
    "3000",
  ]);
});

Deno.test("tsx watch: subcommand and watch flags precede the entry point", () => {
  const argv = new TsxWatchSettings()
    .noClearScreen().include("src").exclude("dist")
    .tsconfig("tsconfig.json").script("src/main.ts").argv();
  assertEquals(argv, [
    "tsx",
    "watch",
    "--clear-screen=false",
    "--include",
    "src",
    "--exclude",
    "dist",
    "--tsconfig",
    "tsconfig.json",
    "src/main.ts",
  ]);
});

Deno.test("tsx watch: minimal watches just the entry point", () => {
  assertEquals(new TsxWatchSettings().script("app.ts").argv(), [
    "tsx",
    "watch",
    "app.ts",
  ]);
});

Deno.test("tsx: a missing script is reported", () => {
  assertThrows(
    () => new TsxSettings().argv(),
    Error,
    "@zuke/tsx: .script() is required.",
  );
  assertThrows(
    () => new TsxWatchSettings().argv(),
    Error,
    "@zuke/tsx: .script() is required.",
  );
});

Deno.test("TsxTasks.tsx reaches execution", async () => {
  await assertRejects(
    () => TsxTasks.tsx((s) => missingTool(s.script("main.ts"))),
    ToolNotFoundError,
  );
});

Deno.test("TsxTasks.watch reaches execution", async () => {
  await assertRejects(
    () => TsxTasks.watch((s) => missingTool(s.script("main.ts"))),
    ToolNotFoundError,
  );
});

Deno.test("tsx: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new TsxSettings().script("main.ts"),
    "tsx",
    {
      resolution: "node_modules",
    },
  );
});
