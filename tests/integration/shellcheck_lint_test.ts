// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/shellcheck`: a real build, driven through
 * the CLI `main()` entry point, proving the lint task is reachable as a
 * target's body and that its refusal — a run with no scripts named — fails the
 * build rather than being swallowed by the executor.
 *
 * The test stays hermetic. ShellCheck is an ambient native binary, so nothing
 * here runs a real one: the task is pointed at a binary that cannot exist, and
 * the argv a target would send is asserted from the settings directly.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import {
  ShellcheckSettings,
  ShellcheckTasks,
} from "../../packages/shellcheck/mod.ts";
import { runCli } from "./_harness.ts";

/** A tool path that cannot exist, so resolution fails before any process runs. */
const ABSENT = "/nonexistent/zuke-test-shellcheck";

Deno.test("a shell gate lints its scripts, and refuses a run with none", async () => {
  const sent: string[][] = [];
  class GateBuild extends Build {
    lint = target().description("lint the shipped shell").executes(async () => {
      sent.push(
        new ShellcheckSettings().shell("sh").severity("warning")
          .paths("sh/lib.sh", "bin/gate").argv(),
      );
      await ShellcheckTasks.lint((s) =>
        s.toolPath(ABSENT).shell("sh").paths("sh/lib.sh")
      );
    });
    // A computed file list that came back empty: shellcheck needs a file
    // operand, so the settings refuse rather than sending a run that fails
    // with usage text.
    empty = target().executes(async () => {
      await ShellcheckTasks.lint((s) => s.toolPath(ABSENT).shell("sh"));
    });
  }

  const lint = await runCli(GateBuild, ["lint"]);
  // The binary is absent, so the target fails — after the argv was assembled.
  assertEquals(lint.code, 1);
  assertEquals(sent, [[
    "shellcheck",
    "-s",
    "sh",
    "-S",
    "warning",
    "sh/lib.sh",
    "bin/gate",
  ]]);

  const empty = await runCli(GateBuild, ["empty"]);
  assertEquals(empty.code, 1);
  assertEquals(empty.err.includes("no scripts to check"), true);
});
