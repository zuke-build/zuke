// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
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
      .ui()
      .workers(4)
      .reporter("dot")
      .updateSnapshots()
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
      "--ui",
      "--workers=4",
      "--reporter=dot",
      "--update-snapshots",
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

Deno.test("playwright: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(
    () => new PlaywrightTestSettings(),
    "playwright",
    {
      resolution: "node_modules",
    },
  );
});

Deno.test("every PlaywrightTasks function reaches execution", async () => {
  await assertRejects(
    () => PlaywrightTasks.test(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PlaywrightTasks.install(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PlaywrightTasks.showReport(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PlaywrightTasks.codegen(missingTool),
    ToolNotFoundError,
  );
});
