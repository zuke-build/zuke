// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
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

Deno.test("CodecovTasks.upload reaches execution", async () => {
  await assertRejects(
    () => CodecovTasks.upload((s) => missingTool(s.files("cov.lcov"))),
    ToolNotFoundError,
  );
});

Deno.test("codecov: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new CodecovUploadSettings(),
    "codecovcli",
    {
      resolution: "path",
    },
  );
});

Deno.test("the upload token never reaches the command line", () => {
  // A child's argv is world-readable — `ps`, `/proc/<pid>/cmdline` — so the
  // token travels in CODECOV_TOKEN, which the CLI documents and which another
  // process cannot read the same way.
  //
  // The class records what it registers with the run's redactor: `markSecret`
  // is protected and its effect lands on an ambient redactor a wrapper package
  // cannot install, so the observable thing here is the call. That the redactor
  // then masks is core's half, and core tests it.
  class Spy extends CodecovUploadSettings {
    readonly marked: string[] = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
  }
  const settings = new Spy().token("t0ken");
  const argv = settings.argv();
  assertEquals(argv.includes("--token"), false);
  // Asserted on the whole argv, not just the flag: a regression could pass the
  // value positionally, or glued to the flag as `--token=t0ken`.
  assertEquals(argv.some((a) => a.includes("t0ken")), false);
  // The other half — the renderings the environment route does not cover.
  assertEquals(settings.marked, ["t0ken"]);
});
