import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { TsxSettings, TsxTasks } from "../src/tsx.ts";

Deno.test("the default binary is tsx", () => {
  assertEquals(new TsxSettings().script("main.ts").argv(), ["tsx", "main.ts"]);
});

Deno.test("tsx: every option renders, script and its args last", () => {
  const argv = new TsxSettings()
    .watch().noClearScreen().include("src").exclude("dist")
    .tsconfig("tsconfig.json").envFile(".env").noCache().noWarnings()
    .conditions("development", "browser").importModule("./reg.ts", "dotenv")
    .script("src/main.ts").scriptArgs("--port", 3000).argv();
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

Deno.test("tsx: minimal runs just the entry point", () => {
  assertEquals(new TsxSettings().script("app.ts").argv(), ["tsx", "app.ts"]);
});

Deno.test("tsx: a missing script is reported", () => {
  assertThrows(
    () => new TsxSettings().argv(),
    Error,
    "TsxTasks.run: .script() is required.",
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsx-zz");
};

Deno.test("TsxTasks.run reaches execution", async () => {
  await assertRejects(
    () => TsxTasks.run((s) => missing(s.script("main.ts"))),
    ToolNotFoundError,
  );
});
