/**
 * Integration: unknown CLI flags are rejected, driven through the real CLI
 * `main()` (via {@link runCli}). Covers the did-you-mean suggestion, the
 * no-suggestion case, that the target never runs, and that a declared build
 * parameter flag still works.
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
