import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { OrvalGenerateSettings, OrvalTasks } from "../src/orval.ts";

Deno.test("the default binary is orval", () => {
  assertEquals(new OrvalGenerateSettings().argv(), ["orval"]);
});

Deno.test("generate: every option renders, in order", () => {
  const argv = new OrvalGenerateSettings()
    .config("orval.config.ts").project("petstore").input("openapi.yaml")
    .output("src/api").watch().clean().prettier().biome().mock().argv();
  assertEquals(argv, [
    "orval",
    "--config",
    "orval.config.ts",
    "--project",
    "petstore",
    "--input",
    "openapi.yaml",
    "--output",
    "src/api",
    "--watch",
    "--clean",
    "--prettier",
    "--biome",
    "--mock",
  ]);
});

Deno.test("generate: minimal uses just the config", () => {
  assertEquals(new OrvalGenerateSettings().config("orval.config.ts").argv(), [
    "orval",
    "--config",
    "orval.config.ts",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-orval-zz");
};

Deno.test("OrvalTasks.generate reaches execution", async () => {
  await assertRejects(() => OrvalTasks.generate(missing), ToolNotFoundError);
});

Deno.test("orval: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/orval`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new OrvalGenerateSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
