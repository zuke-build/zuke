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
