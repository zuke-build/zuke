import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { VitestSettings, VitestTasks } from "../src/vitest.ts";

Deno.test("the default invocation is a one-shot run", () => {
  assertEquals(new VitestSettings().argv(), ["vitest", "run"]);
});

Deno.test("watch() switches to the watch subcommand", () => {
  assertEquals(new VitestSettings().watch().argv(), ["vitest", "watch"]);
});

Deno.test("vitest: every option renders, filters last", () => {
  const argv = new VitestSettings()
    .config("vitest.config.ts").root(".").dir("src").coverage().ui().update()
    .forceRun().bail(1).retry(2).shard("1/4").reporter("dot", "junit")
    .outputFile("out.xml").testNamePattern("renders").environment("jsdom")
    .globals().passWithNoTests().silent().filters("math", "string").argv();
  assertEquals(argv, [
    "vitest",
    "run",
    "-c",
    "vitest.config.ts",
    "--root",
    ".",
    "--dir",
    "src",
    "--coverage",
    "--ui",
    "-u",
    "--run",
    "--bail",
    "1",
    "--retry",
    "2",
    "--shard",
    "1/4",
    "--reporter",
    "dot",
    "--reporter",
    "junit",
    "--outputFile",
    "out.xml",
    "-t",
    "renders",
    "--environment",
    "jsdom",
    "--globals",
    "--passWithNoTests",
    "--silent",
    "math",
    "string",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-vitest-zz");
};

Deno.test("VitestTasks.run reaches execution", async () => {
  await assertRejects(() => VitestTasks.run(missing), ToolNotFoundError);
});

Deno.test("vitest: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/vitest`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new VitestSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
