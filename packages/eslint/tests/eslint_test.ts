import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { EslintSettings, EslintTasks } from "../src/eslint.ts";

Deno.test("the default binary is eslint", () => {
  assertEquals(new EslintSettings().argv(), ["eslint"]);
});

Deno.test("eslint: every option renders, paths last", () => {
  const argv = new EslintSettings()
    .config("eslint.config.js").ext(".ts", ".tsx").fix().fixDryRun()
    .fixType("problem", "suggestion").quietWarnings().maxWarnings(0)
    .format("json").outputFile("report.json").cache()
    .cacheLocation(".eslintcache").ignorePath(".eslintignore")
    .ignorePattern("dist/**").noIgnore().noConfigLookup()
    .reportUnusedDisableDirectives().paths("src", "test").argv();
  assertEquals(argv, [
    "eslint",
    "-c",
    "eslint.config.js",
    "--ext",
    ".ts",
    "--ext",
    ".tsx",
    "--fix",
    "--fix-dry-run",
    "--fix-type",
    "problem",
    "--fix-type",
    "suggestion",
    "--quiet",
    "--max-warnings",
    "0",
    "-f",
    "json",
    "-o",
    "report.json",
    "--cache",
    "--cache-location",
    ".eslintcache",
    "--ignore-path",
    ".eslintignore",
    "--ignore-pattern",
    "dist/**",
    "--no-ignore",
    "--no-config-lookup",
    "--report-unused-disable-directives",
    "src",
    "test",
  ]);
});

Deno.test("eslint: minimal lints just the given path", () => {
  assertEquals(new EslintSettings().paths("src").argv(), ["eslint", "src"]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-eslint-zz");
};

Deno.test("EslintTasks.lint reaches execution", async () => {
  await assertRejects(() => EslintTasks.lint(missing), ToolNotFoundError);
});

Deno.test("eslint: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/eslint`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new EslintSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
