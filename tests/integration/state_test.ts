/**
 * Integration: durable build state and locks, driven through the real CLI. With
 * `ZUKE_STATE_DIR` pointed at a temp dir (via the harness), every run persists a
 * record to a {@link FileSystemStateStore}; this suite reads those records back
 * to assert status transitions, and pre-seeds a lock to force a conflict.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Open a store over the temp state dir the harness configured. */
function storeAt(dir: string): FileSystemStateStore {
  return new FileSystemStateStore(dir, defaultStateHost);
}

Deno.test("a successful run is persisted as a succeeded record", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      compile = target().executes(() => {});
      build = target().dependsOn(this.compile).executes(() => {});
    }
    const { code } = await runCli(B, ["build"]);
    assertEquals(code, 0);

    const runs = await storeAt(dir).listRuns({});
    assertEquals(runs.length, 1);
    const got = await storeAt(dir).getRun(runs[0].id);
    assertEquals(got === null, false);
    if (got !== null) {
      assertEquals(got.record.status, "succeeded");
      assertEquals(got.record.rootTarget, "build");
      assertEquals(got.record.targets["compile"].status, "succeeded");
      assertEquals(got.record.targets["build"].status, "succeeded");
    }
  });
});

Deno.test("a failing run is persisted as a failed record", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      boom = target().executes(() => {
        throw new Error("kaboom");
      });
    }
    const { code } = await runCli(B, ["boom"]);
    assertEquals(code, 1);

    const runs = await storeAt(dir).listRuns({});
    assertEquals(runs.length, 1);
    const got = await storeAt(dir).getRun(runs[0].id);
    assertEquals(got === null, false);
    if (got !== null) {
      assertEquals(got.record.status, "failed");
      assertEquals(got.record.targets["boom"].status, "failed");
    }
  });
});

Deno.test("listRuns can filter persisted runs by status", async () => {
  await withStateDir(async (dir) => {
    class Ok extends Build {
      go = target().executes(() => {});
    }
    class Bad extends Build {
      go = target().executes(() => {
        throw new Error("no");
      });
    }
    await runCli(Ok, ["go"]);
    await runCli(Bad, ["go"]);

    const store = storeAt(dir);
    assertEquals((await store.listRuns({})).length, 2);
    assertEquals((await store.listRuns({ status: "succeeded" })).length, 1);
    assertEquals((await store.listRuns({ status: "failed" })).length, 1);
  });
});

Deno.test("a target loses a held lock and fails with the conflict guidance", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    // Pre-seed the lock as held by another actor, with a long TTL so it is live.
    const held = await storeAt(dir).acquireLock(
      "deploy-lock",
      {
        actor: "other-user",
        runId: "other-run",
        since: new Date().toISOString(),
      },
      600_000,
    );
    assertEquals(held.ok, true);

    class B extends Build {
      deploy = target()
        .lock((s) =>
          s.key("deploy-lock").withTtl("1h").onConflict((h) =>
            `held by ${h.actor}; retry`
          )
        )
        .executes(() => void log.push("deploy"));
    }
    const { code, err } = await runCli(B, ["deploy"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "held by other-user");
    assertEquals(log.includes("deploy"), false); // body never ran
  });
});
