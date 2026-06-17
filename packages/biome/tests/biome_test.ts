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

Deno.test("every BiomeTasks function reaches execution", async () => {
  await assertRejects(() => BiomeTasks.check(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.format(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.lint(missing), ToolNotFoundError);
  await assertRejects(() => BiomeTasks.ci(missing), ToolNotFoundError);
});
