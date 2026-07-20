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

Deno.test("tsc: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/tsc`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new TscSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
