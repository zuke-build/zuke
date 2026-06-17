import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  PlaywrightCodegenSettings,
  PlaywrightInstallSettings,
  PlaywrightShowReportSettings,
  PlaywrightTasks,
  PlaywrightTestSettings,
} from "../src/playwright.ts";

Deno.test("the default binary is playwright", () => {
  assertEquals(new PlaywrightTestSettings().argv()[0], "playwright");
});

Deno.test("test: bare, projects, grep, headed, workers, reporter, config, paths", () => {
  assertEquals(new PlaywrightTestSettings().argv().slice(1), ["test"]);
  assertEquals(
    new PlaywrightTestSettings()
      .project("chromium", "firefox")
      .grep("@smoke")
      .headed()
      .workers(4)
      .reporter("dot")
      .config("pw.config.ts")
      .paths("tests/e2e")
      .argv()
      .slice(1),
    [
      "test",
      "--project=chromium",
      "--project=firefox",
      "--grep",
      "@smoke",
      "--headed",
      "--workers=4",
      "--reporter=dot",
      "--config=pw.config.ts",
      "tests/e2e",
    ],
  );
});

Deno.test("install: bare, --with-deps, and named browsers", () => {
  assertEquals(new PlaywrightInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new PlaywrightInstallSettings()
      .withDeps()
      .browsers("chromium", "webkit")
      .argv()
      .slice(1),
    ["install", "--with-deps", "chromium", "webkit"],
  );
});

Deno.test("show-report: bare and with a directory", () => {
  assertEquals(new PlaywrightShowReportSettings().argv().slice(1), [
    "show-report",
  ]);
  assertEquals(
    new PlaywrightShowReportSettings().dir("playwright-report").argv().slice(1),
    ["show-report", "playwright-report"],
  );
});

Deno.test("codegen: bare, --target, --output, and a url", () => {
  assertEquals(new PlaywrightCodegenSettings().argv().slice(1), ["codegen"]);
  assertEquals(
    new PlaywrightCodegenSettings()
      .target("python")
      .output("gen.py")
      .url("https://example.com")
      .argv()
      .slice(1),
    ["codegen", "--target=python", "--output=gen.py", "https://example.com"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each PlaywrightTasks function reaches execution WITHOUT
 * ever invoking a real playwright (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-playwright-xyz");
};

Deno.test("every PlaywrightTasks function reaches execution", async () => {
  await assertRejects(() => PlaywrightTasks.test(missing), ToolNotFoundError);
  await assertRejects(
    () => PlaywrightTasks.install(missing),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PlaywrightTasks.showReport(missing),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PlaywrightTasks.codegen(missing),
    ToolNotFoundError,
  );
});
