import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  DprintCheckSettings,
  DprintFmtSettings,
  DprintTasks,
} from "../src/dprint.ts";

Deno.test("the default binary and subcommands are dprint fmt/check", () => {
  assertEquals(new DprintFmtSettings().argv(), ["dprint", "fmt"]);
  assertEquals(new DprintCheckSettings().argv(), ["dprint", "check"]);
});

Deno.test("dprint fmt: every option renders, files last", () => {
  const argv = new DprintFmtSettings()
    .config("dprint.json").excludes("**/*.md", "vendor/**").incremental()
    .allowNoFiles().files("src", "mod.ts").argv();
  assertEquals(argv, [
    "dprint",
    "fmt",
    "-c",
    "dprint.json",
    "--excludes",
    "**/*.md",
    "--excludes",
    "vendor/**",
    "--incremental",
    "--allow-no-files",
    "src",
    "mod.ts",
  ]);
});

Deno.test("dprint check: minimal checks everything", () => {
  assertEquals(new DprintCheckSettings().argv(), ["dprint", "check"]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-dprint-zz");
};

Deno.test("dprint: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/dprint`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new DprintFmtSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});

Deno.test("DprintTasks.fmt and .check reach execution", async () => {
  await assertRejects(() => DprintTasks.fmt(missing), ToolNotFoundError);
  await assertRejects(() => DprintTasks.check(missing), ToolNotFoundError);
});
