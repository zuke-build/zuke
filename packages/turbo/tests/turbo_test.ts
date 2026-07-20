import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  TurboPruneSettings,
  TurboRunSettings,
  TurboTasks,
} from "../src/turbo.ts";

Deno.test("the default binary is turbo", () => {
  assertEquals(new TurboRunSettings().tasks("build").argv()[0], "turbo");
});

Deno.test("turbo: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/turbo`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new TurboRunSettings();
    s.os_ = "linux"; // pin so the planted bare shim matches on any host
    assertEquals(
      s.cwd(root).tasks("build").resolvedArgv()[0],
      bin.replace(/\\/g, "/"),
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});

Deno.test("run: requires a task; tasks first, then flags", () => {
  assertThrows(
    () => new TurboRunSettings().argv(),
    Error,
    "TurboTasks.run: .tasks(...) requires at least one task",
  );
  assertEquals(new TurboRunSettings().tasks("build").argv().slice(1), [
    "run",
    "build",
  ]);
  assertEquals(
    new TurboRunSettings()
      .tasks("build", "test")
      .filter("web")
      .filter("docs")
      .parallel()
      .concurrency("50%")
      .force()
      .noCache()
      .continue()
      .dryRun()
      .outputLogs("errors-only")
      .argv()
      .slice(1),
    [
      "run",
      "build",
      "test",
      "--filter=web",
      "--filter=docs",
      "--parallel",
      "--concurrency=50%",
      "--force",
      "--no-cache",
      "--continue",
      "--dry-run",
      "--output-logs=errors-only",
    ],
  );
});

Deno.test("prune: requires a package; --docker and --out-dir", () => {
  assertThrows(
    () => new TurboPruneSettings().argv(),
    Error,
    "TurboTasks.prune: .package() is required",
  );
  assertEquals(
    new TurboPruneSettings().package("web").docker().outDir("out").argv().slice(
      1,
    ),
    ["prune", "web", "--docker", "--out-dir=out"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-turbo-xyz");
};

Deno.test("every TurboTasks function reaches execution", async () => {
  await assertRejects(
    () => TurboTasks.run((s) => missing(s).tasks("build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TurboTasks.prune((s) => missing(s).package("web")),
    ToolNotFoundError,
  );
});
