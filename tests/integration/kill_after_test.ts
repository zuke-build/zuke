// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../_testing.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import { Build, RuntimeTasks, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
import { runCli } from "./_harness.ts";
import { EVAL } from "../_eval.ts";

// A cooperative child (it does not trap SIGTERM) so the terminate sequence ends
// at the first signal and the test stays fast; the grace → SIGKILL escalation
// against a SIGTERM-proof child is covered by tests/e2e/kill_after_e2e.ts.
class SlowBuild extends Build {
  slow = target()
    .description("run a child that outlives its killAfter budget")
    .executes(async () => {
      await $`${RuntimeTasks.execPath()} ${EVAL} ${"setTimeout(() => {}, 30000)"}`
        .quiet()
        .killAfter(150);
    });
}

test("a killAfter timeout fails the build through the CLI", async () => {
  const started = performance.now();
  const { code, err } = await runCli(SlowBuild, ["slow"]);
  const elapsed = performance.now() - started;
  assertEquals(code, 1);
  assertStringIncludes(err, "timed out after 150ms");
  // The child would have slept 30s: the timeout really reaped it.
  assertEquals(elapsed < 15_000, true, `took ${Math.round(elapsed)}ms`);
});
