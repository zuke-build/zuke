import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
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

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsgo-zz");
};

Deno.test("TsgoTasks.tsgo reaches execution", async () => {
  await assertRejects(() => TsgoTasks.tsgo(missing), ToolNotFoundError);
});

Deno.test("tsgo: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/tsgo`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new TsgoSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
