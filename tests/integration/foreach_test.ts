// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a `.forEach(...)` fan-out whose factory returns builders it does
 * not own — the pattern a shared pipeline helper produces — driven twice through
 * the real CLI. The second run must behave exactly like the first: materialising
 * works on clones, so the factory's builders are never renamed or re-wired and
 * no duplicate dependency edges accumulate in a long-lived process.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** Every stage's execution, in order, for the run currently under way. */
const log: string[] = [];

// Module-level stages, shared by every item of every run — the factory hands
// back these same two objects each time it is called.
const checks = target()
  .description("verify the item")
  .executes(() => void log.push("checks"));
const deploy = target().executes(() => void log.push("deploy"));

class Batch extends Build {
  deployBatch = target().forEach(
    () => ["alpha", "beta"],
    () => ({ checks, deploy }),
    (s) => s.concurrency(1), // serialise so the log order is deterministic
  );
}

Deno.test("a fan-out over shared stage builders is identical on every run", async () => {
  const runs: string[][] = [];
  for (const _ of [1, 2]) {
    log.length = 0;
    const { code, out } = await runCli(Batch, ["deployBatch"]);
    assertEquals(code, 0);
    for (const name of ["alpha", "beta"]) {
      assertStringIncludes(out, `deployBatch[${name}].checks`);
      assertStringIncludes(out, `deployBatch[${name}].deploy`);
    }
    runs.push([...log]);
  }

  assertEquals(runs[0], ["checks", "deploy", "checks", "deploy"]);
  assertEquals(runs[1], runs[0]); // second run identical — no state carried over

  // The build author's own objects came back untouched.
  assertEquals(checks.name_, undefined);
  assertEquals(deploy.name_, undefined);
  assertEquals(deploy.dependsOn_.length, 0);
  assertEquals(checks.description_, "verify the item");
});
