// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: a run-held lock across real processes. The process that took the
 * lock exits when its run parks; the lock must stay held with nobody alive to
 * heartbeat it, be honoured by an unrelated process, be renewed and released by
 * the process that resumes the run — and, once the parked run's TTL has run
 * out, be taken by someone else and make the resume refuse to continue.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/run_lock_build.ts", import.meta.url);

/** The id and status of the only run under `dir` that `promote` started. */
async function rollout(dir: string): Promise<{ id: string; status: string }> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({ target: "promote" });
  assertEquals(runs.length, 1);
  return { id: runs[0].id, status: runs[0].status };
}

Deno.test("a parked run keeps its lock across processes until it is resumed", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "zuke-run-lock-e2e-" });
  const env = { ZUKE_STATE_DIR: stateDir };
  try {
    const parked = await runFixture(FIXTURE, ["promote"], env);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(parked.out.includes("STAGED"), true, parked.out);
    const { id, status } = await rollout(stateDir);
    assertEquals(status, "suspended");

    // The process that took the lock is gone, and the lock is still held.
    const blocked = await runFixture(FIXTURE, ["hotfix"], env);
    assertEquals(blocked.code, 1, blocked.out);
    assertEquals((blocked.out + blocked.err).includes(id), true, blocked.err);

    const resumed = await runFixture(
      FIXTURE,
      ["resume", id, "--signal", "approved"],
      env,
    );
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(resumed.out.includes("PROMOTED"), true, resumed.out);

    const patched = await runFixture(FIXTURE, ["hotfix"], env);
    assertEquals(patched.code, 0, patched.err);
    assertEquals(patched.out.includes("PATCHED"), true, patched.out);
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("a resume whose lock lapsed to another process refuses and stays parked", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "zuke-run-lock-e2e-" });
  const env = { ZUKE_STATE_DIR: stateDir, ZUKE_E2E_LOCK_TTL: "1s" };
  try {
    const parked = await runFixture(FIXTURE, ["promote"], env);
    assertEquals(parked.code, 0, parked.err);
    const { id } = await rollout(stateDir);

    // Nobody touches the parked run for longer than its lock's TTL.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const hotfix = await runFixture(
      FIXTURE,
      ["hotfix"],
      // The hotfix holds its own lock for an hour from here.
      { ZUKE_STATE_DIR: stateDir },
    );
    assertEquals(hotfix.code, 0, hotfix.err);

    // The hotfix released its target lock when it finished; take the lock as a
    // second, still-running holder by parking another rollout on it.
    const second = await runFixture(FIXTURE, ["promote"], {
      ZUKE_STATE_DIR: stateDir,
    });
    assertEquals(second.code, 0, second.err);

    const resumed = await runFixture(
      FIXTURE,
      ["resume", id, "--signal", "approved"],
      env,
    );
    assertEquals(resumed.code === 0, false, resumed.out);
    assertEquals(
      (resumed.out + resumed.err).includes("cannot resume"),
      true,
      resumed.out + resumed.err,
    );
    const store = new FileSystemStateStore(stateDir, defaultStateHost);
    assertEquals((await store.getRun(id))?.record.status, "suspended");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
