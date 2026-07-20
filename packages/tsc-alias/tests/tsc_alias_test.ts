import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { TscAliasRunSettings, TscAliasTasks } from "../src/tsc_alias.ts";

Deno.test("the default binary is tsc-alias", () => {
  assertEquals(new TscAliasRunSettings().argv(), ["tsc-alias"]);
});

Deno.test("run: every option renders, in order", () => {
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

Deno.test("run: minimal targets the given project", () => {
  assertEquals(new TscAliasRunSettings().project("tsconfig.json").argv(), [
    "tsc-alias",
    "-p",
    "tsconfig.json",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsc-alias-zz");
};

Deno.test("TscAliasTasks.run reaches execution", async () => {
  await assertRejects(() => TscAliasTasks.run(missing), ToolNotFoundError);
});

Deno.test("tsc-alias: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/tsc-alias`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new TscAliasRunSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
