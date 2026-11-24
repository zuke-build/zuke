// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { TscAliasRunSettings, TscAliasTasks } from "../src/tsc_alias.ts";

test("the default binary is tsc-alias", () => {
  assertEquals(new TscAliasRunSettings().argv(), ["tsc-alias"]);
});

test("run: every option renders, in order", () => {
  const argv = new TscAliasRunSettings()
    .project("tsconfig.json").watch().outDir("dist").declarationDir("types")
    .resolveFullPaths().resolveFullExtension(".js")
    .replacers("a.js", "b.js").dir("base").fileExtensions(".js,.jsx")
    .verbose().debug().silent().argv();
  assertEquals(argv, [
    "tsc-alias",
    "-p",
    "tsconfig.json",
    "--watch",
    "--outDir",
    "dist",
    "--declarationDir",
    "types",
    "--resolveFullPaths",
    "--resolveFullExtension",
    ".js",
    "--replacers",
    "a.js",
    "--replacers",
    "b.js",
    "--dir",
    "base",
    "--fileExtensions",
    ".js,.jsx",
    "--verbose",
    "--debug",
    "--silent",
  ]);
});

test("run: minimal targets the given project", () => {
  assertEquals(new TscAliasRunSettings().project("tsconfig.json").argv(), [
    "tsc-alias",
    "-p",
    "tsconfig.json",
  ]);
});

test("TscAliasTasks.run reaches execution", async () => {
  await assertRejects(() => TscAliasTasks.run(missingTool), ToolNotFoundError);
});

test("tsc-alias: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new TscAliasRunSettings(), "tsc-alias", {
    resolution: "node_modules",
  });
});
