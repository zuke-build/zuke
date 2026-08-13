// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: unknown CLI flags and targets are rejected, driven through the
 * real CLI `main()` (via {@link runCli}). Covers the did-you-mean suggestion for
 * both, the no-suggestion case, that the target never runs, that a declared build
 * parameter flag still works, and the invocations rejection must not swallow —
 * `--help` alongside a typo, a bare `--`, and a built-in given an inline value.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("an unknown flag fails the build and suggests the nearest known flag", async () => {
  const log: string[] = [];
  class Demo extends Build {
    deploy = target().executes(() => void log.push("deploy"));
  }
  const { code, err } = await runCli(Demo, ["deploy", "--dry-rn"]);
  assertEquals(code, 1);
  assertStringIncludes(err, '"--dry-rn"');
  assertStringIncludes(err, 'Did you mean "--dry-run"?');
  // The unknown flag stops the build before any target runs.
  assertEquals(log, []);
});

Deno.test("an unknown flag with no near match fails without a suggestion", async () => {
  class Demo extends Build {
    deploy = target().executes(() => {});
  }
  const { code, err } = await runCli(Demo, ["deploy", "--no-such-flag"]);
  assertEquals(code, 1);
  assertStringIncludes(err, '"--no-such-flag"');
  assertEquals(err.includes("Did you mean"), false);
});

Deno.test("an unknown target fails and suggests the nearest known target", async () => {
  // cspell:ignore depoly
  class Demo extends Build {
    deploy = target().executes(() => {});
  }
  const { code, err } = await runCli(Demo, ["depoly"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "Unknown target: depoly.");
  assertStringIncludes(err, 'Did you mean "deploy"?');
});

Deno.test("--help wins over an unknown flag on the same line", async () => {
  const log: string[] = [];
  class Demo extends Build {
    deploy = target().executes(() => void log.push("deploy"));
  }
  const { code, out } = await runCli(Demo, ["--help", "--bogus"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "Usage:");
  assertEquals(log, []);
});

Deno.test("a bare -- separator is skipped, not rejected", async () => {
  const log: string[] = [];
  class Demo extends Build {
    deploy = target().executes(() => void log.push("deploy"));
  }
  const { code } = await runCli(Demo, ["--", "deploy"]);
  assertEquals(code, 0);
  assertEquals(log, ["deploy"]);
});

Deno.test("a built-in given an inline value names the real fix, not itself", async () => {
  const log: string[] = [];
  class Demo extends Build {
    lint = target().executes(() => void log.push("lint"));
    deploy = target().dependsOn(this.lint).executes(() => void log.push("d"));
  }
  const { code, err } = await runCli(Demo, ["deploy", "--skip=lint"]);
  assertEquals(code, 1);
  assertStringIncludes(err, '"--skip=lint"');
  assertStringIncludes(err, 'does not take an inline "=value"');
  // Never "did you mean --skip?" as the fix for --skip.
  assertEquals(err.includes("Did you mean"), false);
  assertEquals(log, []);
});

Deno.test("a declared build parameter flag still parses and runs", async () => {
  const log: string[] = [];
  class Demo extends Build {
    env = parameter("Target environment").required();
    deploy = target().executes(() => void log.push(this.env.value));
  }
  const { code } = await runCli(Demo, ["deploy", "--env", "prod"]);
  assertEquals(code, 0);
  assertEquals(log, ["prod"]);
});
