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
