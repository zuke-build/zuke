import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { CodecovTasks, CodecovUploadSettings } from "../src/codecov.ts";

Deno.test("default tool is codecovcli, subcommand upload-process", () => {
  assertEquals(new CodecovUploadSettings().argv(), [
    "codecovcli",
    "upload-process",
  ]);
});

Deno.test("codecov: every setting renders in a deterministic order", () => {
  const argv = new CodecovUploadSettings()
    .token("t0ken")
    .slug("acme/app")
    .sha("abc123")
    .branch("main")
    .pullRequest(42)
    .gitService("github")
    .name("local-upload")
    .dir("coverage")
    .networkRootFolder("src")
    .reportType("coverage")
    .files("cov.lcov", "other.lcov")
    .flags("unit", "integration")
    .plugins("noop")
    .disableSearch()
    .handleNoReportsFound()
    .failOnError()
    .dryRun()
    .argv();
  assertEquals(argv, [
    "codecovcli",
    "upload-process",
    "--token",
    "t0ken",
    "--slug",
    "acme/app",
    "--sha",
    "abc123",
    "--branch",
    "main",
    "--pr",
    "42",
    "--git-service",
    "github",
    "--name",
    "local-upload",
    "--dir",
    "coverage",
    "--network-root-folder",
    "src",
    "--report-type",
    "coverage",
    "--file",
    "cov.lcov",
    "--file",
    "other.lcov",
    "--flag",
    "unit",
    "--flag",
    "integration",
    "--plugin",
    "noop",
    "--disable-search",
    "--handle-no-reports-found",
    "--fail-on-error",
    "--dry-run",
  ]);
});

Deno.test("codecov: pullRequest accepts a string too", () => {
  assertEquals(new CodecovUploadSettings().pullRequest("99").argv(), [
    "codecovcli",
    "upload-process",
    "--pr",
    "99",
  ]);
});

// Force a missing binary on a known OS so the run reaches execution and fails
// with ToolNotFoundError rather than depending on an ambient `codecovcli`.
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-codecovcli-zz");
};

Deno.test("CodecovTasks.upload reaches execution", async () => {
  await assertRejects(
    () => CodecovTasks.upload((s) => missing(s.files("cov.lcov"))),
    ToolNotFoundError,
  );
});
