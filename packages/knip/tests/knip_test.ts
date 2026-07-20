import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { KnipRunSettings, KnipTasks } from "../src/knip.ts";

Deno.test("the default binary is knip", () => {
  assertEquals(new KnipRunSettings().argv()[0], "knip");
});

Deno.test("run: bare is empty argv", () => {
  assertEquals(new KnipRunSettings().argv().slice(1), []);
});

Deno.test("run: all options render", () => {
  assertEquals(
    new KnipRunSettings()
      .production()
      .strict()
      .fix()
      .cache()
      .noExitCode()
      .config("knip.json")
      .workspace("packages/web")
      .reporter("compact")
      .include("files", "dependencies")
      .argv()
      .slice(1),
    [
      "--production",
      "--strict",
      "--fix",
      "--cache",
      "--no-exit-code",
      "--config",
      "knip.json",
      "--workspace",
      "packages/web",
      "--reporter",
      "compact",
      "--include",
      "files,dependencies",
    ],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-knip-xyz");
};

Deno.test("KnipTasks.run reaches execution", async () => {
  await assertRejects(() => KnipTasks.run(missing), ToolNotFoundError);
});

Deno.test("knip: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/knip`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new KnipRunSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
