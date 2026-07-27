import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { TsgoSettings, TsgoTasks } from "../src/tsgo.ts";

Deno.test("the default binary is tsgo", () => {
  assertEquals(new TsgoSettings().argv(), ["tsgo"]);
});

Deno.test("tsgo: every option renders, paths last", () => {
  const argv = new TsgoSettings()
    .project("tsconfig.json").noEmit().outDir("dist").declaration()
    .emitDeclarationOnly().incremental().watch().strict().pretty()
    .listFiles().skipLibCheck().noEmitOnError().target("es2022")
    .module("nodenext").paths("a.ts", "b.ts").argv();
  assertEquals(argv, [
    "tsgo",
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

Deno.test("tsgo: minimal checks the given file", () => {
  assertEquals(new TsgoSettings().paths("mod.ts").argv(), ["tsgo", "mod.ts"]);
});

Deno.test("TsgoTasks.tsgo reaches execution", async () => {
  await assertRejects(() => TsgoTasks.tsgo(missingTool), ToolNotFoundError);
});

Deno.test("tsgo: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new TsgoSettings(), "tsgo", {
    resolution: "node_modules",
  });
});
