import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { TscBuildSettings, TscSettings, TscTasks } from "../src/tsc.ts";

Deno.test("the default binary is tsc", () => {
  assertEquals(new TscSettings().argv(), ["tsc"]);
  assertEquals(new TscBuildSettings().argv(), ["tsc", "--build"]);
});

Deno.test("tsc: every option renders, paths last", () => {
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

Deno.test("tsc: minimal checks the given file", () => {
  assertEquals(new TscSettings().paths("mod.ts").argv(), ["tsc", "mod.ts"]);
});

Deno.test("build: every option renders, projects last", () => {
  const argv = new TscBuildSettings()
    .clean().force().dry().watch().verbose().incremental()
    .projects("packages/a", "packages/b").argv();
  assertEquals(argv, [
    "tsc",
    "--build",
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

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsc-zz");
};

Deno.test("TscTasks.tsc reaches execution", async () => {
  await assertRejects(() => TscTasks.tsc(missing), ToolNotFoundError);
});

Deno.test("TscTasks.build reaches execution", async () => {
  await assertRejects(() => TscTasks.build(missing), ToolNotFoundError);
});
