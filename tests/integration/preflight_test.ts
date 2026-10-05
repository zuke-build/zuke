// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the preflight phase through the CLI `main()` — a validation's
 * preflight refuses a run before any target, a dependency included, has
 * started; `--preflight` runs only that phase; and it is how a step holding no
 * secrets asks "may this run?" without tripping over the parameters those
 * secrets fill.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  parameter,
  target,
  type Validation,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** A validation whose preflight records itself and refuses when `refuse`. */
function gate(log: string[], refuse: boolean): Validation {
  return {
    validate: () => {
      log.push("validate");
    },
    preflight: ({ target }) => {
      log.push(`preflight:${target}`);
      if (refuse) throw new Error("this caller may not start the run");
    },
  };
}

/** A build whose `deploy` depends on `prepare` and is gated by `check`. */
function pipeline(log: string[], check: Validation) {
  return class Pipeline extends Build {
    key = parameter("API key").secret().required();
    prepare = target().executes(() => {
      log.push("prepare");
      return Promise.resolve();
    });
    deploy = target()
      .dependsOn(this.prepare)
      .validateBefore(check)
      .executes(() => {
        log.push("deploy");
        return Promise.resolve();
      });
  };
}

Deno.test("a refusing preflight stops the run before a dependency has started", async () => {
  const log: string[] = [];
  const result = await runCli(pipeline(log, gate(log, true)), [
    "deploy",
    "--key=k",
  ]);
  assertEquals(result.code === 0, false);
  assertEquals(log, ["preflight:deploy"]);
  assertStringIncludes(
    result.err + result.out,
    "preflight refused the run (deploy): this caller may not start the run",
  );
});

Deno.test("an admitted run executes as before, its preflight first", async () => {
  const log: string[] = [];
  const result = await runCli(pipeline(log, gate(log, false)), [
    "deploy",
    "--key=k",
  ]);
  assertEquals(result.code, 0);
  assertEquals(log, ["preflight:deploy", "prepare", "validate", "deploy"]);
});

Deno.test("--preflight runs only the preflights, without the secrets the run needs", async () => {
  const log: string[] = [];
  // No --key: the step that asks holds no secrets, by design.
  const passed = await runCli(pipeline(log, gate(log, false)), [
    "deploy",
    "--preflight",
  ]);
  assertEquals(passed.code, 0);
  assertEquals(log, ["preflight:deploy"]);
  assertStringIncludes(passed.out, "preflight passed — 1 check(s)");
  log.length = 0;
  const refused = await runCli(pipeline(log, gate(log, true)), [
    "deploy",
    "--preflight",
  ]);
  assertEquals(refused.code === 0, false);
  assertEquals(log, ["preflight:deploy"]);
});

Deno.test("a missing secret still fails a real run, and a dry run skips the preflight", async () => {
  const log: string[] = [];
  const missing = await runCli(pipeline(log, gate(log, false)), ["deploy"]);
  assertEquals(missing.code === 0, false);
  assertEquals(log, []);
  const dry = await runCli(pipeline(log, gate(log, true)), [
    "deploy",
    "--key=k",
    "--dry-run",
  ]);
  assertEquals(dry.code, 0);
  assertEquals(log, []);
});
