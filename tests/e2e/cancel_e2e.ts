// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: cross-process cancellation. Process A runs the
 * {@link file://./fixtures/cancel_build.ts} pipeline to its approval gate and
 * suspends, persisting the run. Process B — a genuinely separate `zuke cancel`
 * subprocess — stops it, runs the deploy's compensation (reading the slot the
 * deploy persisted), and settles the record as `cancelled`. Proves the whole
 * flow across real OS processes over a shared temp `ZUKE_STATE_DIR`, the thing
 * the in-process suite cannot. Excluded from the fast unit gate; run by the
 * `integration` target on the OS matrix.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/cancel_build.ts", import.meta.url);

Deno.test("a separate process cancels a suspended run and runs its compensation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-" });
  try {
    // Process 1: run to the gate and suspend, persisting the run.
    const suspend = await runFixture(FIXTURE, ["promote"], {
      ZUKE_STATE_DIR: dir,
    });
    assertEquals(suspend.code, 0);
    assertStringIncludes(suspend.out, "DEPLOYED");

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;
    assertEquals(runs[0].status, "suspended");

    // Process 2: cancel it. The compensation runs, reading the deploy's slot.
    const cancelled = await runFixture(FIXTURE, ["cancel", id], {
      ZUKE_STATE_DIR: dir,
    });
    assertEquals(cancelled.code, 0);
    assertStringIncludes(cancelled.out, "ROLLED_BACK:sit-7");
    // The gate never opened, so promote never ran.
    assertEquals(cancelled.out.includes("PROMOTED"), false);

    // The record is durably cancelled.
    const loaded = await store.getRun(id);
    assertEquals(loaded?.record.status, "cancelled");
    assertEquals(loaded?.record.events.some((e) => e.tool === "cancel"), true);
  } finally {
    // Best-effort: a cleanup failure must not mask the real assertion error.
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

/**
 * Spawn the fixture and resolve once it has printed `marker`, so the parent
 * signals a run that is genuinely in flight rather than one still starting up.
 */
async function spawnUntil(
  args: string[],
  dir: string,
  marker: string,
): Promise<{ child: Deno.ChildProcess; out: () => string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir },
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const decoder = new TextDecoder();
  let text = "";
  const reader = child.stdout.getReader();
  while (!text.includes(marker)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  // Keep draining in the background so the child never blocks on a full pipe.
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } catch { /* the pipe closes when the child exits */ }
  })();
  return { child, out: () => text };
}

Deno.test({
  name: "a signalled run hands its lease back instead of holding it to the TTL",
  // Windows has no graceful stop to deliver. `installCancelSignals` installs
  // only SIGINT there (SIGTERM is unsupported), and Deno cannot send a child a
  // signal it can *handle* on Windows — a kill terminates the process outright,
  // so the run never reaches the settle-and-release path this asserts. The
  // behaviour itself is still covered on all three OSes by the unit test "a
  // cancelled run gives its lease back rather than holding it to the TTL",
  // which drives the same path in-process; what is Unix-only is proving it
  // survives a real signal to a real second process.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      // Process 1: deploy, then block — the run is `running` and its lease held.
      const { child } = await spawnUntil(["hold"], dir, "HOLDING");
      const store = new FileSystemStateStore(dir, defaultStateHost);
      const runs = await store.listRuns({ status: "running" });
      assertEquals(runs.length, 1);
      const id = runs[0].id;

      // While it is running, its claim is genuinely held: a sweep asking whether
      // anyone is there must be told yes.
      const whileLive = await store.acquireLock(
        `zuke-run-${id}`,
        { actor: "sweep", runId: id, since: new Date().toISOString() },
        1_000,
      );
      assertEquals(whileLive.ok, false);

      // Signal it the way an operator's Ctrl-C or a CI timeout would, and let it
      // settle.
      child.kill();
      await child.status;

      // The record is terminal, so the claim must be back — a lease still held for
      // the rest of its TTL says a process is working on a run that has provably
      // ended, and blocks recovery for a minute for no reason.
      const afterExit = await store.acquireLock(
        `zuke-run-${id}`,
        { actor: "sweep", runId: id, since: new Date().toISOString() },
        1_000,
      );
      assertEquals(
        afterExit.ok,
        true,
        "the cancelled run never released its lease",
      );
      const loaded = await store.getRun(id);
      assertEquals(loaded?.record.status, "cancelled");
    }, { prefix: "zuke-e2e-" });
  },
});
