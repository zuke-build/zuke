import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  BiomeCheckSettings,
  BiomeCiSettings,
  BiomeFormatSettings,
  BiomeLintSettings,
  BiomeTasks,
} from "../src/biome.ts";

Deno.test("the default binary is biome", () => {
  assertEquals(new BiomeCheckSettings().argv()[0], "biome");
});

Deno.test("shared filters: config, reporter, --staged, --changed, paths", () => {
  assertEquals(
    new BiomeCiSettings()
      .config("biome.json")
      .reporter("github")
      .staged()
      .changed()
      .paths("src", "test")
      .argv()
      .slice(1),
    [
      "ci",
      "--config-path=biome.json",
      "--reporter=github",
      "--staged",
      "--changed",
      "src",
      "test",
    ],
  );
});

Deno.test("check: bare, --write, --unsafe with paths", () => {
  assertEquals(new BiomeCheckSettings().argv().slice(1), ["check"]);
  assertEquals(
    new BiomeCheckSettings().write().unsafe().paths("src").argv().slice(1),
    ["check", "--write", "--unsafe", "src"],
  );
});

Deno.test("format: --write with paths", () => {
  assertEquals(
    new BiomeFormatSettings().write().paths("src").argv().slice(1),
    ["format", "--write", "src"],
  );
});

Deno.test("lint: --write, --unsafe with paths", () => {
  assertEquals(
    new BiomeLintSettings().write().unsafe().paths("src").argv().slice(1),
    ["lint", "--write", "--unsafe", "src"],
  );
});

Deno.test("ci: bare", () => {
  assertEquals(new BiomeCiSettings().argv().slice(1), ["ci"]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-biome-xyz");
};

Deno.test("biome: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/biome`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new BiomeCheckSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});

Deno.test("every BiomeTasks function reaches execution", async () => {
  await assertRejects(() => BiomeTasks.check(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.format(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.lint(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.ci(missing), ToolNotFoundError);
});
