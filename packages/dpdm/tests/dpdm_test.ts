import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { DpdmAnalyzeSettings, DpdmTasks } from "../src/dpdm.ts";

Deno.test("the default binary is dpdm", () => {
  assertEquals(new DpdmAnalyzeSettings().argv()[0], "dpdm");
});

Deno.test("analyze: bare is empty argv", () => {
  assertEquals(new DpdmAnalyzeSettings().argv().slice(1), []);
});

Deno.test("analyze: entries are appended after the flags", () => {
  assertEquals(
    new DpdmAnalyzeSettings()
      .noTree()
      .entries("src/index.ts", "src/cli.ts")
      .argv()
      .slice(1),
    ["--no-tree", "src/index.ts", "src/cli.ts"],
  );
});

Deno.test("analyze: all options render in order", () => {
  assertEquals(
    new DpdmAnalyzeSettings()
      .transform()
      .noTree()
      .noCircular()
      .noWarning()
      .noProgress()
      .output("deps.json")
      .tsconfig("tsconfig.json")
      .context("src")
      .extensions(".ts", ".tsx")
      .js(".mjs", ".js")
      .include("\\.ts$")
      .exclude("node_modules")
      .skipDynamicImports("circular")
      .detectUnusedFilesFrom("src/**/*")
      .exitCode("circular:1")
      .entries("src/index.ts")
      .argv()
      .slice(1),
    [
      "--transform",
      "--no-tree",
      "--no-circular",
      "--no-warning",
      "--no-progress",
      "--output",
      "deps.json",
      "--tsconfig",
      "tsconfig.json",
      "--context",
      "src",
      "--extensions",
      ".ts,.tsx",
      "--js",
      ".mjs,.js",
      "--include",
      "\\.ts$",
      "--exclude",
      "node_modules",
      "--skip-dynamic-imports",
      "circular",
      "--detect-unused-files-from",
      "src/**/*",
      "--exit-code",
      "circular:1",
      "src/index.ts",
    ],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-dpdm-xyz");
};

Deno.test("DpdmTasks.analyze reaches execution", async () => {
  await assertRejects(() => DpdmTasks.analyze(missing), ToolNotFoundError);
});

Deno.test("dpdm: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/dpdm`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new DpdmAnalyzeSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
