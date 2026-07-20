import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { TsxSettings, TsxTasks, TsxWatchSettings } from "../src/tsx.ts";

Deno.test("the default binary is tsx", () => {
  assertEquals(new TsxSettings().script("main.ts").argv(), ["tsx", "main.ts"]);
});

Deno.test("tsx: every option renders, script and its args last", () => {
  const argv = new TsxSettings()
    .tsconfig("tsconfig.json").envFile(".env").noCache().noWarnings()
    .conditions("development", "browser").importModule("./reg.ts", "dotenv")
    .script("src/main.ts").scriptArgs("--port", 3000).argv();
  assertEquals(argv, [
    "tsx",
    "--tsconfig",
    "tsconfig.json",
    "--env-file=.env",
    "--no-cache",
    "--no-warnings",
    "--conditions",
    "development",
    "--conditions",
    "browser",
    "--import",
    "./reg.ts",
    "--import",
    "dotenv",
    "src/main.ts",
    "--port",
    "3000",
  ]);
});

Deno.test("tsx watch: subcommand and watch flags precede the entry point", () => {
  const argv = new TsxWatchSettings()
    .noClearScreen().include("src").exclude("dist")
    .tsconfig("tsconfig.json").script("src/main.ts").argv();
  assertEquals(argv, [
    "tsx",
    "watch",
    "--clear-screen=false",
    "--include",
    "src",
    "--exclude",
    "dist",
    "--tsconfig",
    "tsconfig.json",
    "src/main.ts",
  ]);
});

Deno.test("tsx watch: minimal watches just the entry point", () => {
  assertEquals(new TsxWatchSettings().script("app.ts").argv(), [
    "tsx",
    "watch",
    "app.ts",
  ]);
});

Deno.test("tsx: a missing script is reported", () => {
  assertThrows(
    () => new TsxSettings().argv(),
    Error,
    "@zuke/tsx: .script() is required.",
  );
  assertThrows(
    () => new TsxWatchSettings().argv(),
    Error,
    "@zuke/tsx: .script() is required.",
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsx-zz");
};

Deno.test("TsxTasks.tsx reaches execution", async () => {
  await assertRejects(
    () => TsxTasks.tsx((s) => missing(s.script("main.ts"))),
    ToolNotFoundError,
  );
});

Deno.test("TsxTasks.watch reaches execution", async () => {
  await assertRejects(
    () => TsxTasks.watch((s) => missing(s.script("main.ts"))),
    ToolNotFoundError,
  );
});

Deno.test("tsx: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/tsx`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new TsxSettings();
    s.os_ = "linux";
    assertEquals(
      s.cwd(root).script("main.ts").resolvedArgv()[0],
      bin.replace(/\\/g, "/"),
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
