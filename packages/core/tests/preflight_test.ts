// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `src/preflight.ts` — every planned validation's preflight,
 * once, in plan order, stopping at the first refusal.
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target, type Validation } from "../src/target.ts";
import { runPreflights } from "../src/preflight.ts";

/** A validation recording its preflight under `name`, refusing when `refuse`. */
function check(log: string[], name: string, refuse = false): Validation {
  return {
    validate: () => {},
    preflight: ({ target, runId, redact }) => {
      log.push(`${name}@${target}:${runId}:${redact("x")}`);
      if (refuse) throw new Error(`${name} says no`);
    },
  };
}

Deno.test("runPreflights calls each distinct validation once, before, during and after, in plan order", async () => {
  const log: string[] = [];
  const shared = check(log, "shared");
  class B extends Build {
    a = target().validateBefore(shared, check(log, "a-before"))
      .executes(() => {});
    b = target().dependsOn(this.a)
      .validateBefore(shared)
      .validateDuring((s) => s.every(1000).check(check(log, "b-during")))
      .validateAfter(check(log, "b-after"))
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const outcome = await runPreflights([b.a, b.b], "run-7");
  assertEquals(outcome, { ok: true, checked: 4 });
  assertEquals(log, [
    "shared@a:run-7:x",
    "a-before@a:run-7:x",
    "b-during@b:run-7:x",
    "b-after@b:run-7:x",
  ]);
});

Deno.test("runPreflights stops at the first refusal and names its target", async () => {
  const log: string[] = [];
  const refusal = check(log, "gate", true);
  class B extends Build {
    a = target().validateBefore(refusal).executes(() => {});
    b = target().validateBefore(check(log, "later")).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const outcome = await runPreflights([b.a, b.b], "r");
  assertEquals(outcome.ok, false);
  assertEquals(outcome.ok ? "" : outcome.target, "a");
  assertEquals(
    !outcome.ok && outcome.error instanceof Error ? outcome.error.message : "",
    "gate says no",
  );
  assertEquals(log, ["gate@a:r:x"]);
});

Deno.test("runPreflights skips validations without one, and a malformed during block", async () => {
  class B extends Build {
    a = target()
      .validateBefore({ validate: () => {} })
      .validateDuring((s) => s) // no interval: the target reports it when run
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertEquals(await runPreflights([b.a], "r"), { ok: true, checked: 0 });
});
