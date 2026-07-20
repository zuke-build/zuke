import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { CspellSettings, CspellTasks } from "../src/cspell.ts";

Deno.test("the default invocation is cspell lint", () => {
  assertEquals(new CspellSettings().argv(), ["cspell", "lint"]);
});

Deno.test("cspell: every option renders, files last", () => {
  const argv = new CspellSettings()
    .config("cspell.json").noProgress().noSummary().showSuggestions()
    .showContext().quietOutput().cache().dot().gitignore().unique()
    .locale("en,en-GB").exclude("dist/**").exclude("vendor/**")
    .maxDuplicateProblems(5).files("**", "docs/**").argv();
  assertEquals(argv, [
    "cspell",
    "lint",
    "-c",
    "cspell.json",
    "--no-progress",
    "--no-summary",
    "--show-suggestions",
    "--show-context",
    "--quiet",
    "--cache",
    "--dot",
    "--gitignore",
    "--unique",
    "--locale",
    "en,en-GB",
    "-e",
    "dist/**",
    "-e",
    "vendor/**",
    "--max-duplicate-problems",
    "5",
    "**",
    "docs/**",
  ]);
});

Deno.test("cspell: minimal checks just the given glob", () => {
  assertEquals(new CspellSettings().files("**").argv(), [
    "cspell",
    "lint",
    "**",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-cspell-zz");
};

Deno.test("CspellTasks.lint reaches execution", async () => {
  await assertRejects(() => CspellTasks.lint(missing), ToolNotFoundError);
});

Deno.test("cspell: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/cspell`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new CspellSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
