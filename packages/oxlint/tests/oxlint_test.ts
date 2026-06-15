import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { OxlintSettings, OxlintTasks } from "../src/oxlint.ts";

Deno.test("the default binary is oxlint", () => {
  assertEquals(new OxlintSettings().argv(), ["oxlint"]);
});

Deno.test("oxlint: every option renders, paths last", () => {
  const argv = new OxlintSettings()
    .config(".oxlintrc.json").tsconfig("tsconfig.json").fix().fixSuggestions()
    .deny("no-debugger").warn("eqeqeq").allow("no-console")
    .ignorePath(".gitignore").ignorePattern("dist/**").maxWarnings(0)
    .quietWarnings().denyWarnings().format("github").threads(4)
    .paths("src", "test").argv();
  assertEquals(argv, [
    "oxlint",
    "-c",
    ".oxlintrc.json",
    "--tsconfig",
    "tsconfig.json",
    "--fix",
    "--fix-suggestions",
    "-D",
    "no-debugger",
    "-W",
    "eqeqeq",
    "-A",
    "no-console",
    "--ignore-path",
    ".gitignore",
    "--ignore-pattern",
    "dist/**",
    "--max-warnings",
    "0",
    "--quiet",
    "--deny-warnings",
    "-f",
    "github",
    "--threads",
    "4",
    "src",
    "test",
  ]);
});

Deno.test("oxlint: minimal lints just the given path", () => {
  assertEquals(new OxlintSettings().paths("src").argv(), ["oxlint", "src"]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-oxlint-zz");
};

Deno.test("OxlintTasks.lint reaches execution", async () => {
  await assertRejects(() => OxlintTasks.lint(missing), ToolNotFoundError);
});
