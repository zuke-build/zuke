// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a run-held lock driven through the real CLI. One rollout parks at
 * an approval gate holding the lock; a second rollout of the same service is
 * refused for as long as the first is parked; `zuke resume` finishes the first
 * and gives the lock back, after which the second goes through. Each `runCli`
 * is a fresh `main()` — a separate process as far as the run is concerned.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A rollout of `api` that holds its lock for the whole run. */
class Rollout extends Build {
  stage = target()
    .lock((s) => s.lockKey("deploy", "api").withTtl("1h").holdForRun())
    .executes(() => {});
  approve = target()
    .dependsOn(this.stage)
    .waitsFor((s) => s.on(externalSignal("approved")));
  promote = target().dependsOn(this.approve).executes(() => {});
}

/** A hotfix of the same service, which must not run during a rollout. */
class Hotfix extends Build {
  patch = target()
    .lock((s) => s.lockKey("deploy", "api").withTtl("1h"))
    .executes(() => {});
}

Deno.test("a parked rollout keeps its lock until zuke resume finishes it", async () => {
  await withStateDir(async (dir) => {
    const first = await runCli(Rollout, ["promote"]);
    assertEquals(first.code, 0);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const [parked] = await store.listRuns({});
    assertEquals(parked.status, "suspended");

    // The first target ended long ago; the lock is still the parked run's.
    const blocked = await runCli(Hotfix, ["patch"]);
    assertEquals(blocked.code, 1);
    assertStringIncludes(blocked.err, `run ${parked.id}`);

    const resumed = await runCli(Rollout, [
      "resume",
      parked.id,
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0);

    const after = await runCli(Hotfix, ["patch"]);
    assertEquals(after.code, 0);
  });
});

Deno.test("zuke cancel gives a parked run's lock back", async () => {
  await withStateDir(async (dir) => {
    await runCli(Rollout, ["promote"]);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const [parked] = await store.listRuns({});
    const cancelled = await runCli(Rollout, ["cancel", parked.id]);
    assertEquals(cancelled.code, 0);
    const after = await runCli(Hotfix, ["patch"]);
    assertEquals(after.code, 0);
  });
});
