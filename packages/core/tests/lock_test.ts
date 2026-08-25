// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { acquireTargetLock } from "../src/lock.ts";
import { target } from "../src/target.ts";
import { LockConflictError, type LockHolder } from "../src/state/lock.ts";
import type { LockResult, StateStore } from "../src/state/store.ts";
import type { RunEnv } from "../src/run_support.ts";
import type { RunQuery, RunRecord, RunSummary } from "../src/state/types.ts";

/**
 * A store whose lock is held by someone else for the first `heldFor` attempts,
 * and free after that — enough to drive every path through the wait without a
 * second process.
 */
class FakeStore implements StateStore {
  attempts = 0;
  released = 0;
  constructor(
    private heldFor: number,
    private holder: LockHolder = {
      actor: "alice",
      runId: "run-1",
      since: "2026-01-01T00:00:00.000Z",
    },
  ) {}

  acquireLock(): Promise<LockResult> {
    this.attempts++;
    if (this.attempts <= this.heldFor) {
      return Promise.resolve({ ok: false, holder: this.holder });
    }
    return Promise.resolve({ ok: true, token: "token" });
  }
  renewLock(): Promise<boolean> {
    return Promise.resolve(true);
  }
  releaseLock(): Promise<void> {
    this.released++;
    return Promise.resolve();
  }
  /** Hand the lock to a different run, so the wait sees the holder change. */
  handOverTo(holder: LockHolder): void {
    this.holder = holder;
  }
  getRun(): Promise<{ record: RunRecord; version: string } | null> {
    return Promise.resolve(null);
  }
  putRun(): Promise<{ ok: true; version: string }> {
    return Promise.resolve({ ok: true, version: "1" });
  }
  listRuns(_query: RunQuery): Promise<RunSummary[]> {
    return Promise.resolve([]);
  }
  deleteRun(): Promise<void> {
    return Promise.resolve();
  }
}

/** A run environment carrying just what lock acquisition reads. */
function envWith(store: StateStore, signal?: AbortSignal): RunEnv {
  return {
    runId: "run-2",
    signal: signal ?? new AbortController().signal,
    store,
    actor: "bob",
    signals: new Map(),
    statuses: new Map(),
  };
}

Deno.test("a lock with no wait fails on the first conflict", async () => {
  const store = new FakeStore(5);
  const t = target()
    .lock((s) => s.key("dev-env").withTtl("1h"))
    .executes(() => {});
  const error = await assertRejects(
    () => acquireTargetLock(t, envWith(store)),
    LockConflictError,
  );
  assertEquals(store.attempts, 1);
  assertStringIncludes(error.message, `Lock "dev-env" is held by alice`);
  // Nothing was waited for, so the message must not claim otherwise.
  assertEquals(error.message.includes("after waiting"), false);
});

Deno.test("waitUpTo queues for the lock and takes it when it frees", async () => {
  const store = new FakeStore(2);
  const lines: string[] = [];
  const t = target()
    .lock((s) =>
      s.key("dev-env").withTtl("1h").waitUpTo("10s").pollEvery("1ms")
    )
    .executes(() => {});

  const held = await acquireTargetLock(t, envWith(store), (l) => lines.push(l));
  assertEquals(held === null, false);
  assertEquals(store.attempts, 3); // two conflicts, then the lock
  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0] ?? "", `Waiting for lock "dev-env"`);
  assertStringIncludes(lines[0] ?? "", "held by alice (run run-1)");
  assertStringIncludes(lines[0] ?? "", "Retrying every 1ms for up to 10s");

  await held?.release();
  assertEquals(store.released, 1);
});

Deno.test("a waiter that runs out of time fails, naming the holder and the wait", async () => {
  const store = new FakeStore(Number.MAX_SAFE_INTEGER);
  const t = target()
    .lock((s) =>
      s.key("dev-env").withTtl("1h").waitUpTo("20ms").pollEvery("1ms")
    )
    .executes(() => {});

  const error = await assertRejects(
    () => acquireTargetLock(t, envWith(store)),
    LockConflictError,
  );
  // The structured holder travels with the error, for a programmatic caller.
  assertEquals(
    error instanceof LockConflictError && error.holder.actor === "alice",
    true,
  );
  assertStringIncludes(error.message, "still held after waiting 20ms");
  assertEquals(store.attempts > 1, true); // it really retried
});

Deno.test("the waiting line is reprinted only when the holder changes", async () => {
  const store = new FakeStore(4);
  const lines: string[] = [];
  const t = target()
    .lock((s) =>
      s.key("dev-env").withTtl("1h").waitUpTo("10s").pollEvery("1ms")
    )
    .executes(() => {});

  // Two runs hold the lock in turn while this target waits.
  const original = store.acquireLock.bind(store);
  let swapped = false;
  store.acquireLock = () => {
    if (!swapped && store.attempts === 2) {
      swapped = true;
      store.handOverTo({
        actor: "carol",
        runId: "run-9",
        since: "2026-01-01T00:05:00.000Z",
      });
    }
    return original();
  };

  await acquireTargetLock(t, envWith(store), (l) => lines.push(l));
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0] ?? "", "held by alice");
  assertStringIncludes(lines[1] ?? "", "held by carol");
});

Deno.test("a cancelled run stops waiting instead of holding the run open", async () => {
  const store = new FakeStore(Number.MAX_SAFE_INTEGER);
  const controller = new AbortController();
  const t = target()
    .lock((s) => s.key("dev-env").withTtl("1h").waitUpTo("1h").pollEvery("5m"))
    .executes(() => {});

  const acquisition = assertRejects(
    () => acquireTargetLock(t, envWith(store, controller.signal)),
    LockConflictError,
  );
  controller.abort();
  await acquisition;
  // Two attempts at most: the first conflict, and the retry the abort released.
  assertEquals(store.attempts <= 2, true);
});

Deno.test("a custom onConflict still renders the failure after a wait", async () => {
  const store = new FakeStore(Number.MAX_SAFE_INTEGER);
  const t = target()
    .lock((s) =>
      s.key("dev-env").withTtl("1h").waitUpTo("5ms").pollEvery("1ms")
        .onConflict((h) => `the stack belongs to ${h.actor} right now`)
    )
    .executes(() => {});

  const error = await assertRejects(
    () => acquireTargetLock(t, envWith(store)),
    LockConflictError,
  );
  assertEquals(error.message, "the stack belongs to alice right now");
});
