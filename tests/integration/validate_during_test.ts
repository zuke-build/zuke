// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `.validateDuring(...)` driven through the real CLI. A long body
 * runs a real child process; a check that goes red stops the child and fails
 * the build at once, rather than after the body would have finished.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
import { runCli } from "./_harness.ts";

/** Set once the child the body started has gone. */
let childEnded = false;

/** A bake that would soak for 30s, watched by a check that fails at once. */
class Bake extends Build {
  bake = target()
    .executes(async () => {
      try {
        await $`${Deno.execPath()} eval ${"await new Promise((r) => setTimeout(r, 30000))"}`
          .quiet();
      } finally {
        childEnded = true;
      }
    })
    .validateDuring((s) =>
      s.every(50).check({
        validate: () => {
          throw new Error("5xx ratio 2.3% is above 1%");
        },
      })
    );
}

Deno.test("a failing check stops the body's child process and fails the build", async () => {
  const started = performance.now();
  const { code, err } = await runCli(Bake, ["bake"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "5xx ratio 2.3% is above 1%");
  // The target does not wait for the body; the child is stopped by the signal.
  for (let i = 0; i < 100 && !childEnded; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assertEquals(childEnded, true);
  const elapsed = performance.now() - started;
  assertEquals(elapsed < 15_000, true, `took ${Math.round(elapsed)}ms`);
});
