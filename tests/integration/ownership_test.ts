/**
 * Integration tests for run ownership, driven through the real CLI.
 *
 * The hazard these close is the one the shape checks cannot see. A `zuke.ts`
 * templated across services agrees on its class name, its target names and its
 * graph, and differs only in what the bodies do — so one service's
 * `zuke resume --check` against a shared state store would pick up another
 * service's suspended run and execute its own bodies against that record.
 * A recorded origin is what separates them, and an absent one still abstains, so
 * a run written before the field existed remains recoverable.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import type { RunRecord } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The (single) run record the CLI persisted under `dir`. */
async function onlyRun(dir: string): Promise<RunRecord> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  const got = await store.getRun(runs[0].id);
  if (got === null) throw new Error("the run vanished");
  return got.record;
}

/**
 * Run `fn` with `ZUKE_BUILD_ID` set to `id`, restoring whatever was there.
 *
 * The same shape as the harness's own `withStateDir`: the CLI reads its origin
 * from the environment, so an integration test has to set it there.
 */
async function withBuildId(id: string, fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("ZUKE_BUILD_ID");
  Deno.env.set("ZUKE_BUILD_ID", id);
  try {
    await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("ZUKE_BUILD_ID");
    else Deno.env.set("ZUKE_BUILD_ID", prev);
  }
}

Deno.test("a sweep drives its own build's run and leaves another's alone", async () => {
  await withStateDir(async (dir) => {
    const promoted: string[] = [];
    // The gate is shut on the first pass and open afterwards, so a sweep that
    // *does* pick the run up finishes it — which is what tells a skipped run
    // from one that was driven and merely re-suspended.
    let gateOpen = false;
    class Cd extends Build {
      deploy = target().executes(() => {});
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "the gate", isSatisfied: () => gateOpen })
      );
      promote = target().dependsOn(this.gate).executes(() => {
        promoted.push("promote");
      });
    }

    await withBuildId("acme/api", async () => {
      assertEquals((await runCli(Cd, ["promote"])).code, 0);
    });
    const suspended = await onlyRun(dir);
    assertEquals(suspended.status, "suspended");
    assertEquals(suspended.buildId, "acme/api");
    assertEquals(promoted, []);

    gateOpen = true;

    // Another service's sweep, over the same store. The gate is open, so without
    // the ownership check this would run *this* build's `promote` against that
    // run — and report success while doing it.
    await withBuildId("acme/web", async () => {
      const swept = await runCli(Cd, ["resume", "--check"]);
      // Skipped, not failed: a cron watches the exit code, and a foreign run
      // must not make it permanently non-zero.
      assertEquals(swept.code, 0);
    });
    assertEquals(promoted, []);
    assertEquals((await onlyRun(dir)).status, "suspended");

    // The owning service's sweep finishes it.
    await withBuildId("acme/api", async () => {
      assertEquals((await runCli(Cd, ["resume", "--check"])).code, 0);
    });
    assertEquals(promoted, ["promote"]);
    assertEquals((await onlyRun(dir)).status, "succeeded");
  });
});

Deno.test("a run recorded with no origin is still swept", async () => {
  // No ZUKE_BUILD_ID and no GITHUB_REPOSITORY in the environment of either pass,
  // so nothing is recorded and nothing is compared — the behaviour every build
  // had before the field existed, and the reason its absence abstains.
  await withStateDir(async (dir) => {
    const promoted: string[] = [];
    let gateOpen = false;
    class Cd extends Build {
      deploy = target().executes(() => {});
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "the gate", isSatisfied: () => gateOpen })
      );
      promote = target().dependsOn(this.gate).executes(() => {
        promoted.push("promote");
      });
    }

    const prevId = Deno.env.get("ZUKE_BUILD_ID");
    const prevRepo = Deno.env.get("GITHUB_REPOSITORY");
    Deno.env.delete("ZUKE_BUILD_ID");
    Deno.env.delete("GITHUB_REPOSITORY");
    try {
      assertEquals((await runCli(Cd, ["promote"])).code, 0);
      const suspended = await onlyRun(dir);
      assertEquals(suspended.status, "suspended");
      assertEquals(suspended.buildId, undefined);

      gateOpen = true;
      assertEquals((await runCli(Cd, ["resume", "--check"])).code, 0);
      assertEquals(promoted, ["promote"]);
      assertEquals((await onlyRun(dir)).status, "succeeded");
    } finally {
      if (prevId !== undefined) Deno.env.set("ZUKE_BUILD_ID", prevId);
      if (prevRepo !== undefined) Deno.env.set("GITHUB_REPOSITORY", prevRepo);
    }
  });
});
