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
  NestBuildSettings,
  NestGenerateSettings,
  NestInfoSettings,
  NestNewSettings,
  NestStartSettings,
  NestTasks,
} from "../src/nest.ts";

Deno.test("the default binary is nest and the subcommand follows", () => {
  assertEquals(new NestInfoSettings().argv(), ["nest", "info"]);
});

Deno.test("nest: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new NestInfoSettings(), "nest", {
    resolution: "node_modules",
  });
});

Deno.test("new renders every option and requires a name", () => {
  assertEquals(new NestNewSettings().name("my-app").argv(), [
    "nest",
    "new",
    "my-app",
  ]);
  assertEquals(
    new NestNewSettings()
      .name("my-app")
      .directory("apps/api")
      .skipInstall()
      .skipGit()
      .strict()
      .dryRun()
      .packageManager("pnpm")
      .language("ts")
      .argv(),
    [
      "nest",
      "new",
      "my-app",
      "--directory",
      "apps/api",
      "--skip-install",
      "--skip-git",
      "--strict",
      "--dry-run",
      "--package-manager",
      "pnpm",
      "--language",
      "ts",
    ],
  );
  assertThrows(() => new NestNewSettings().argv(), Error, ".name()");
});

Deno.test("generate renders every option and requires a schematic", () => {
  assertEquals(new NestGenerateSettings().schematic("module").argv(), [
    "nest",
    "generate",
    "module",
  ]);
  assertEquals(
    new NestGenerateSettings()
      .schematic("service")
      .name("users")
      .project("api")
      .collection("@nestjs/schematics")
      .flat()
      .spec()
      .noSpec()
      .skipImport()
      .dryRun()
      .argv(),
    [
      "nest",
      "generate",
      "service",
      "users",
      "--project",
      "api",
      "--collection",
      "@nestjs/schematics",
      "--flat",
      "--spec",
      "--no-spec",
      "--skip-import",
      "--dry-run",
    ],
  );
  assertThrows(
    () => new NestGenerateSettings().argv(),
    Error,
    ".schematic()",
  );
});

Deno.test("build renders every option with the app positional last", () => {
  assertEquals(new NestBuildSettings().argv(), ["nest", "build"]);
  assertEquals(
    new NestBuildSettings()
      .config("nest-cli.json")
      .path("tsconfig.build.json")
      .watch()
      .webpack()
      .tsc()
      .builder("swc")
      .preserveWatchOutput()
      .app("api")
      .argv(),
    [
      "nest",
      "build",
      "--config",
      "nest-cli.json",
      "--path",
      "tsconfig.build.json",
      "--watch",
      "--webpack",
      "--tsc",
      "--builder",
      "swc",
      "--preserveWatchOutput",
      "api",
    ],
  );
});

Deno.test("start renders every option with the app positional last", () => {
  assertEquals(new NestStartSettings().argv(), ["nest", "start"]);
  assertEquals(
    new NestStartSettings()
      .config("nest-cli.json")
      .path("tsconfig.build.json")
      .watch()
      .debug()
      .preserveWatchOutput()
      .exec("node")
      .builder("swc")
      .app("api")
      .argv(),
    [
      "nest",
      "start",
      "--config",
      "nest-cli.json",
      "--path",
      "tsconfig.build.json",
      "--watch",
      "--debug",
      "--preserveWatchOutput",
      "--exec",
      "node",
      "--builder",
      "swc",
      "api",
    ],
  );
});

Deno.test("NestTasks.new reaches execution", async () => {
  await assertRejects(
    () => NestTasks.new((s) => missingTool(s.name("my-app"))),
    ToolNotFoundError,
  );
});

Deno.test("NestTasks.generate reaches execution", async () => {
  await assertRejects(
    () => NestTasks.generate((s) => missingTool(s.schematic("module"))),
    ToolNotFoundError,
  );
});

Deno.test("NestTasks.build reaches execution", async () => {
  await assertRejects(() => NestTasks.build(missingTool), ToolNotFoundError);
});

Deno.test("NestTasks.start reaches execution", async () => {
  await assertRejects(() => NestTasks.start(missingTool), ToolNotFoundError);
});

Deno.test("NestTasks.info reaches execution", async () => {
  await assertRejects(() => NestTasks.info(missingTool), ToolNotFoundError);
});
