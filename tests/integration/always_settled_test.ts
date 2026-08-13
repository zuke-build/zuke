// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for `.always()` readiness — a target that runs *because*
 * something failed must not be held back by that failure.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

Deno.test("an always target runs when a dependency failed, and can report on it", async () => {
  // The aggregate-gate shape: one target that reports a single verdict for a
  // fan of checks. It has to run in exactly the case a plain dependency edge
  // would block it.
  let verdict: string | undefined;
  let failedNames: string[] = [];

  class Ci extends Build {
    lint = target().proceedAfterFailure().executes(() => {});
    test = target().proceedAfterFailure().executes(() => {
      throw new Error("2 tests failed");
    });
    gate = target()
      .dependsOn(this.lint, this.test)
      .always()
      .executes((ctx) => {
        failedNames = [...ctx.outcomes()]
          .filter(([, o]) => o.status === "failed")
          .map(([name]) => name);
        verdict = failedNames.length === 0 ? "success" : "failure";
      });
  }

  const { code } = await runCli(Ci, ["gate"]);
  assertEquals(verdict, "failure");
  assertEquals(failedNames, ["test"]);
  // The gate passing does not rescue the build: it reports the failure, it does
  // not absorb it.
  assertEquals(code, 1);
});

Deno.test("the failure's message reaches the always target", async () => {
  let message: string | undefined;

  class Ci extends Build {
    broken = target().proceedAfterFailure().executes(() => {
      throw new Error("2 tests failed");
    });
    gate = target().dependsOn(this.broken).always().executes((ctx) => {
      message = ctx.outcomeOf("broken")?.error;
    });
  }

  await runCli(Ci, ["gate"]);
  assertEquals(message, "2 tests failed");
});

Deno.test("a non-always target is still blocked by a failed dependency", async () => {
  // The change is scoped to `.always()`. An ordinary dependent must not start
  // running against a dependency that failed.
  let ran = false;

  class Ci extends Build {
    broken = target().proceedAfterFailure().executes(() => {
      throw new Error("nope");
    });
    dependent = target().dependsOn(this.broken).executes(() => {
      ran = true;
    });
  }

  const { code } = await runCli(Ci, ["dependent"]);
  assertEquals(ran, false);
  assertEquals(code, 1);
});

Deno.test("an always target waits for a parked wait rather than reporting early", async () => {
  // A dependency at a `.waitsFor(...)` gate has not settled — it is going to be
  // resumed. Releasing the always target here would have it report on a run
  // that is still in progress, and the resume would then find it already done.
  const ran: string[] = [];

  class Cd extends Build {
    hold = target().waitsFor((s) => s.on(externalSignal("go")));
    gate = target().dependsOn(this.hold).always().executes(() => {
      ran.push("gate");
    });
  }

  await withStateDir(async (dir) => {
    const first = await runCli(Cd, ["gate"]);
    assertEquals(first.code, 0); // suspended
    assertEquals(ran, []); // the gate did NOT fire early

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);

    const resumed = await runCli(Cd, ["resume", runs[0].id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    assertEquals(ran, ["gate"]); // it fires once the wait resolves
  });
});

Deno.test("an always target still runs when its dependencies all passed", async () => {
  const ran: string[] = [];

  class Ci extends Build {
    unit = target().executes(() => void ran.push("unit"));
    cleanup = target().dependsOn(this.unit).always().executes(() => {
      ran.push("cleanup");
    });
  }

  const { code } = await runCli(Ci, ["cleanup"]);
  assertEquals(code, 0);
  assertEquals(ran, ["unit", "cleanup"]);
});
