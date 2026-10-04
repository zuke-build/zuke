// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for run-held locks — `.lock((s) => s.holdForRun())` — which are
 * held until the run settles rather than until their target's body ends, and
 * which survive a suspend and resume.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { resumeCheck, resumeRun } from "../src/resume.ts";
import { cancelRun, settleExternally } from "../src/cancel.ts";
import { externalSignal } from "../src/wait.ts";
import { messageOf } from "../src/internal.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { LockConflictError, type LockHolder } from "../src/state/lock.ts";
import type { PutResult, StateStore } from "../src/state/store.ts";
import {
  parseRunRecord,
  type RunLock,
  type RunRecord,
} from "../src/state/types.ts";
import { reclaimRunLocks, RunLockHolder } from "../src/run_locks.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { withTempStore } from "./_store.ts";
import { withTemp } from "./_temp.ts";

const KEY = "deploy-api";

/** Another run's identity, for probing whether a lock is free. */
const OTHER: LockHolder = {
  actor: "other",
  runId: "run-other",
  since: "2026-10-04T00:00:00.000Z",
};

/** Whether `key` is free in `store` right now: take it as another run, then give it back. */
async function isFree(store: StateStore, key = KEY): Promise<boolean> {
  const result = await store.acquireLock(key, OTHER, 60_000);
  if (!result.ok) return false;
  await store.releaseLock(key, result.token);
  return true;
}

/** The stored record of run `id`. */
async function recordOf(store: StateStore, id: string): Promise<RunRecord> {
  const got = await store.getRun(id);
  if (got === null) throw new Error(`run ${id} not found`);
  return got.record;
}

/** A build that takes a run-held lock, then has `later` run after it. */
function chain(store: StateStore, seen: boolean[]) {
  return class extends Build {
    stage = target()
      .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
      .executes(() => {});
    later = target().dependsOn(this.stage).executes(async () => {
      // Probed from inside the run: the lock must still be held after the
      // target that took it has finished.
      seen.push(!(await isFree(store)));
    });
  };
}

Deno.test("a run-held lock outlives its target and is released when the run settles", async () => {
  await withTempStore(async (store) => {
    const seen: boolean[] = [];
    const B = chain(store, seen);
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.later, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(seen, [true]);
    assertEquals(await isFree(store), true);
    const record = result.runId ? await recordOf(store, result.runId) : null;
    assertEquals(record?.locks, undefined);
  });
});

Deno.test("a target-scoped lock is still released when its own target ends", async () => {
  await withTempStore(async (store) => {
    const seen: boolean[] = [];
    class B extends Build {
      stage = target().lock((s) => s.key(KEY).withTtl("1h")).executes(() => {});
      later = target().dependsOn(this.stage).executes(async () => {
        seen.push(!(await isFree(store)));
      });
    }
    const b = new B();
    discoverTargets(b);
    await execute(b, b.later, { silent: true, stateStore: store });
    assertEquals(seen, [false]);
  });
});

Deno.test("a later target declaring the same run-held key reuses the lock", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      promote = target()
        .dependsOn(this.stage)
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.promote, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(await isFree(store), true);
  });
});

Deno.test("a failed run releases its run-held lock", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      verify = target().dependsOn(this.stage).executes(() => {
        throw new Error("unhealthy");
      });
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.verify, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertEquals(await isFree(store), true);
  });
});

/** A rollout that takes a run-held lock, then parks at an approval gate. */
class Rollout extends Build {
  seen: boolean[] = [];
  store?: StateStore;
  stage = target()
    .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
    .executes(() => {});
  approve = target()
    .dependsOn(this.stage)
    .waitsFor((s) => s.on(externalSignal("approved")).timeout("1h"));
  promote = target().dependsOn(this.approve).executes(async () => {
    if (this.store !== undefined) this.seen.push(!(await isFree(this.store)));
  });
}

/** Start a rollout and leave it parked at its gate; returns its run id. */
async function parkRollout(store: StateStore): Promise<string> {
  const b = new Rollout();
  discoverTargets(b);
  const result = await execute(b, b.promote, {
    silent: true,
    stateStore: store,
  });
  assertEquals(result.suspended, true);
  if (result.runId === undefined) throw new Error("no run id");
  return result.runId;
}

Deno.test("a parked run keeps its lock, and a resume finishes and releases it", async () => {
  await withTempStore(async (store) => {
    const id = await parkRollout(store);
    // Parked: the lock is held and recorded, so a second rollout is refused.
    assertEquals(await isFree(store), false);
    assertEquals((await recordOf(store, id)).locks?.[0]?.key, KEY);

    const b = new Rollout();
    b.store = store;
    discoverTargets(b);
    const result = await resumeRun(b, {
      runId: id,
      signal: "approved",
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, true);
    assertEquals(b.seen, [true]); // still held while the resumed run promoted
    assertEquals(await isFree(store), true);
    assertEquals((await recordOf(store, id)).locks, undefined);
  });
});

Deno.test("a second run is refused the lock a parked run holds", async () => {
  await withTempStore(async (store) => {
    await parkRollout(store);
    const b = new Rollout();
    discoverTargets(b);
    const second = await execute(b, b.promote, {
      silent: true,
      stateStore: store,
    });
    assertEquals(second.ok, false);
    assertEquals(second.error instanceof LockConflictError, true);
  });
});

Deno.test("cancelling a parked run releases its run-held lock", async () => {
  await withTempStore(async (store) => {
    const id = await parkRollout(store);
    await cancelRun(new Rollout(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(await isFree(store), true);
    assertEquals((await recordOf(store, id)).locks, undefined);
  });
});

Deno.test("a wait that times out with fail releases the run-held lock", async () => {
  await withTempStore(async (store) => {
    class Quick extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      approve = target()
        .dependsOn(this.stage)
        .waitsFor((s) => s.on(externalSignal("approved")).timeout(1));
    }
    const b = new Quick();
    discoverTargets(b);
    const parked = await execute(b, b.approve, {
      silent: true,
      stateStore: store,
    });
    assertEquals(parked.suspended, true);
    await new Promise((r) => setTimeout(r, 10));
    await resumeCheck(new Quick(), { stateStore: store, silent: true });
    const id = parked.runId ?? "";
    assertEquals((await recordOf(store, id)).status, "failed");
    assertEquals(await isFree(store), true);
    assertEquals((await recordOf(store, id)).locks, undefined);
  });
});

Deno.test("a resume re-takes a lock that lapsed while parked, if it is still free", async () => {
  await withTempStore(async (store) => {
    const id = await parkRollout(store);
    const recorded = (await recordOf(store, id)).locks?.[0];
    if (recorded === undefined) throw new Error("no recorded lock");
    // The lapse: the store no longer honours the recorded token.
    await store.releaseLock(recorded.key, recorded.token);

    const b = new Rollout();
    b.store = store;
    discoverTargets(b);
    const result = await resumeRun(b, {
      runId: id,
      signal: "approved",
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, true);
    assertEquals(b.seen, [true]);
    assertEquals(await isFree(store), true);
  });
});

Deno.test("a resume whose lapsed lock went to another run is refused and stays parked", async () => {
  await withTempStore(async (store) => {
    const id = await parkRollout(store);
    const recorded = (await recordOf(store, id)).locks?.[0];
    if (recorded === undefined) throw new Error("no recorded lock");
    await store.releaseLock(recorded.key, recorded.token);
    const taken = await store.acquireLock(KEY, OTHER, 60_000);
    if (!taken.ok) throw new Error("could not take the lapsed lock");

    const error = await assertRejects(
      () =>
        resumeRun(new Rollout(), {
          runId: id,
          signal: "approved",
          stateStore: store,
          silent: true,
        }),
      LockConflictError,
    );
    assertStringIncludes(messageOf(error), "cannot resume");
    assertStringIncludes(messageOf(error), "run-other");
    assertEquals((await recordOf(store, id)).status, "suspended");
  });
});

Deno.test("reclaimRunLocks keeps renewed locks and gives back only re-taken ones on conflict", async () => {
  await withTempStore(async (store) => {
    const me: LockHolder = { actor: "me", runId: "run-me", since: "t" };
    const kept = await store.acquireLock("a", me, 60_000);
    const lapsed = await store.acquireLock("b", me, 60_000);
    if (!kept.ok || !lapsed.ok) throw new Error("setup failed");
    await store.releaseLock("b", lapsed.token); // b lapsed and is free
    const locks: RunLock[] = [
      { key: "a", token: kept.token, ttlMs: 60_000, target: "stage" },
      { key: "b", token: lapsed.token, ttlMs: 60_000, target: "stage" },
      { key: "c", token: "gone", ttlMs: 60_000, target: "stage" },
    ];
    // c lapsed and another run holds it.
    const other = await store.acquireLock("c", OTHER, 60_000);
    if (!other.ok) throw new Error("setup failed");

    await assertRejects(
      () => reclaimRunLocks(store, locks, me),
      LockConflictError,
    );
    // a was renewed and is still the run's; b was re-taken and given back.
    assertEquals(await isFree(store, "a"), false);
    assertEquals(await isFree(store, "b"), true);
  });
});

Deno.test("reclaimRunLocks returns fresh tokens for the locks it re-took", async () => {
  await withTempStore(async (store) => {
    const me: LockHolder = { actor: "me", runId: "run-me", since: "t" };
    const held = await store.acquireLock("a", me, 60_000);
    if (!held.ok) throw new Error("setup failed");
    await store.releaseLock("a", held.token);
    const { locks: [lock], retaken } = await reclaimRunLocks(
      store,
      [{ key: "a", token: held.token, ttlMs: 60_000, target: "stage" }],
      me,
    );
    assertEquals(retaken, [lock]);
    assertEquals(lock.key, "a");
    assertEquals(lock.token === held.token, false);
    assertEquals(await store.renewLock("a", lock.token, 60_000), true);
    assertEquals(await reclaimRunLocks(store, undefined, me), {
      locks: [],
      retaken: [],
    });
  });
});

Deno.test("RunLockHolder parks by renewing, and stop leaves the lock held", async () => {
  await withTempStore(async (store) => {
    const me: LockHolder = { actor: "me", runId: "run-me", since: "t" };
    const held = await store.acquireLock("a", me, 60_000);
    if (!held.ok) throw new Error("setup failed");
    const holder = new RunLockHolder(store);
    holder.adopt({ key: "a", token: held.token, ttlMs: 60_000, target: "s" });
    assertEquals(holder.holds("a"), true);
    await holder.park();
    assertEquals(holder.holds("a"), false);
    assertEquals(await isFree(store, "a"), false);
    holder.adopt({ key: "a", token: held.token, ttlMs: 60_000, target: "s" });
    holder.stop();
    assertEquals(await isFree(store, "a"), false);
    // A store-less holder is inert.
    const inert = new RunLockHolder(undefined);
    inert.adopt({ key: "z", token: "t", ttlMs: 1000, target: "s" });
    assertEquals(inert.holds("z"), false);
    await inert.park();
    await inert.release();
  });
});

/** A store that refuses every write that would record a run-held lock. */
class NoLockRecords extends FileSystemStateStore {
  override putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    if (record.locks !== undefined) {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expectedVersion);
  }
}

Deno.test("a run-held lock the record cannot carry is given back and fails the target", async () => {
  await withTemp(async (dir) => {
    const store = new NoLockRecords(`${dir}/runs`, defaultStateHost);
    let ran = false;
    class B extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => void (ran = true));
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.stage, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertEquals(ran, false);
    assertStringIncludes(messageOf(result.error), "could not record it");
    assertEquals(await isFree(store), true);
  });
});

Deno.test("the run record parses its locks strictly", () => {
  const base = {
    id: "r",
    build: "B",
    rootTarget: "t",
    status: "suspended",
    actor: "a",
    createdAt: "t",
    updatedAt: "t",
    graph: [],
    params: {},
    targets: {},
  };
  const lock = { key: "k", token: "tok", ttlMs: 1000, target: "stage" };
  assertEquals(
    parseRunRecord(JSON.stringify({ ...base, locks: [lock] })).locks,
    [lock],
  );
  assertEquals(parseRunRecord(JSON.stringify(base)).locks, undefined);
  assertThrows(
    () => parseRunRecord(JSON.stringify({ ...base, locks: {} })),
    Error,
    `field "locks" is not an array`,
  );
  assertThrows(
    () => parseRunRecord(JSON.stringify({ ...base, locks: ["x"] })),
    Error,
    "run lock 0 is not an object",
  );
  assertThrows(
    () =>
      parseRunRecord(
        JSON.stringify({ ...base, locks: [{ ...lock, ttlMs: 0 }] }),
      ),
    Error,
    `has no positive "ttlMs"`,
  );
  assertThrows(
    () =>
      parseRunRecord(
        JSON.stringify({ ...base, locks: [{ ...lock, token: 3 }] }),
      ),
    Error,
    "token",
  );
});

Deno.test("parallel targets declaring the same run-held key take it once", async () => {
  await withTempStore(async (store) => {
    const slow = () => new Promise<void>((r) => setTimeout(r, 30));
    class B extends Build {
      a = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(slow);
      b = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(slow);
      all = target().dependsOn(this.a, this.b).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      parallel: true,
    });
    assertEquals(result.ok, true);
    assertEquals(await isFree(store), true);
  });
});

Deno.test("a target-scoped lock on a key the run holds does not conflict with the run", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      patch = target()
        .dependsOn(this.stage)
        .lock((s) => s.key(KEY).withTtl("1h"))
        .executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.patch, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(await isFree(store), true);
  });
});

/** A build whose second target blocks on `gate` while the run holds the lock. */
function blocking(gate: Promise<void>, started: () => void) {
  return class extends Build {
    stage = target()
      .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
      .executes(() => {});
    roll = target().dependsOn(this.stage).executes(async () => {
      started();
      await gate;
    });
  };
}

Deno.test("cancelling a running run leaves its lock with the body until the body stops", async () => {
  await withTempStore(async (store) => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    let markStarted: () => void = () => {};
    const started = new Promise<void>((r) => (markStarted = r));
    const B = blocking(gate, markStarted);
    const b = new B();
    discoverTargets(b);
    const running = execute(b, b.roll, { silent: true, stateStore: store });
    await started;
    const [summary] = await store.listRuns({});
    await cancelRun(new B(), {
      runId: summary.id,
      stateStore: store,
      silent: true,
    });
    // Settled, but the body is still going: the lock stays with it.
    assertEquals((await recordOf(store, summary.id)).status, "cancelled");
    assertEquals(await isFree(store), false);
    open();
    await running;
    assertEquals(await isFree(store), true);
  });
});

Deno.test("settling a run whose owner is gone releases its locks with the settlement", async () => {
  await withTempStore(async (store) => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    let markStarted: () => void = () => {};
    const started = new Promise<void>((r) => (markStarted = r));
    const B = blocking(gate, markStarted);
    const b = new B();
    discoverTargets(b);
    const running = execute(b, b.roll, { silent: true, stateStore: store });
    await started;
    const [summary] = await store.listRuns({});
    await settleExternally(new B(), {
      runId: summary.id,
      stateStore: store,
      silent: true,
      terminal: "failed",
      ownerGone: true,
    });
    assertEquals(await isFree(store), true);
    open();
    await running;
  });
});

/** A store that throws on the next write recording a run-held lock, or on a resume, when told to. */
class ThrowingStore extends FileSystemStateStore {
  failNextLockWrite = false;
  failResumes = false;
  override putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    const resuming = this.failResumes && record.status === "running";
    const lockWrite = this.failNextLockWrite && record.locks !== undefined;
    if (lockWrite || resuming) {
      this.failNextLockWrite = false;
      return Promise.reject(new Error("store unavailable"));
    }
    return super.putRun(record, expectedVersion);
  }
}

Deno.test("a lock the record failed to carry leaves no trace for a later write to persist", async () => {
  await withTemp(async (dir) => {
    const store = new ThrowingStore(`${dir}/runs`, defaultStateHost);
    store.failNextLockWrite = true;
    const seen: unknown[] = [];
    // Whichever of the two runs first has its lock write refused; the other's
    // write starts from the live record, so a phantom entry the refused write
    // left behind would land with it.
    const holding = (key: string) =>
      target()
        .proceedAfterFailure()
        .lock((s) => s.key(key).withTtl("1h").holdForRun())
        .executes(async (ctx) => {
          const record = await recordOf(store, ctx.runId);
          seen.push(record.locks?.map((l) => l.key).join(","));
        });
    class B extends Build {
      one = holding("one");
      two = holding("two");
      all = target().dependsOn(this.one, this.two).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    await execute(b, b.all, { silent: true, stateStore: store });
    assertEquals(seen.length, 1);
    assertEquals(seen[0] === "one" || seen[0] === "two", true);
  });
});

Deno.test("a resume that fails to move the run keeps the locks the parked run still owns", async () => {
  await withTemp(async (dir) => {
    const store = new ThrowingStore(`${dir}/runs`, defaultStateHost);
    const id = await parkRollout(store);
    store.failResumes = true;
    await assertRejects(() =>
      resumeRun(new Rollout(), {
        runId: id,
        signal: "approved",
        stateStore: store,
        silent: true,
      })
    );
    assertEquals((await recordOf(store, id)).status, "suspended");
    assertEquals(await isFree(store), false);
  });
});

Deno.test("a target-scoped sibling and a run-held one on the same key never wait on their own run", async () => {
  for (const scopedFirst of [true, false]) {
    await withTempStore(async (store) => {
      const slow = () => new Promise<void>((r) => setTimeout(r, 30));
      const scoped = () =>
        target()
          .lock((s) => s.key(KEY).withTtl("1h").waitUpTo("1h"))
          .executes(slow);
      const held = () =>
        target()
          .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
          .executes(slow);
      class B extends Build {
        a = scopedFirst ? scoped() : held();
        b = scopedFirst ? held() : scoped();
        all = target().dependsOn(this.a, this.b).executes(() => {});
      }
      const b = new B();
      discoverTargets(b);
      const result = await execute(b, b.all, {
        silent: true,
        stateStore: store,
        parallel: true,
      });
      // Whichever takes the key first, the run either shares it or names the
      // real cause — never a wait on itself.
      if (!result.ok) {
        assertStringIncludes(messageOf(result.error), "same run holds it");
      }
      assertEquals(await isFree(store), true);
    });
  }
});

/** A store whose next `getRun` answers with a snapshot taken earlier. */
class StaleOnce extends FileSystemStateStore {
  stale: { record: RunRecord; version: string } | null = null;
  override async getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    const stale = this.stale;
    this.stale = null;
    return stale ?? await super.getRun(id);
  }
}

Deno.test("a cancel that read a parked run which has since resumed leaves the lock with the body", async () => {
  await withTemp(async (dir) => {
    const store = new StaleOnce(`${dir}/runs`, defaultStateHost);
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    let markStarted: () => void = () => {};
    const started = new Promise<void>((r) => (markStarted = r));
    class Gated extends Build {
      stage = target()
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      approve = target()
        .dependsOn(this.stage)
        .waitsFor((s) => s.on(externalSignal("approved")).timeout("1h"));
      promote = target().dependsOn(this.approve).executes(async () => {
        markStarted();
        await gate;
      });
    }
    const b = new Gated();
    discoverTargets(b);
    const parked = await execute(b, b.promote, {
      silent: true,
      stateStore: store,
    });
    const id = parked.runId ?? "";
    const snapshot = await store.getRun(id); // suspended
    const resuming = resumeRun(new Gated(), {
      runId: id,
      signal: "approved",
      stateStore: store,
      silent: true,
    });
    await started;
    store.stale = snapshot;
    await cancelRun(new Gated(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(await isFree(store), false); // the resumed body still runs
    open();
    await resuming;
    assertEquals(await isFree(store), true);
  });
});

Deno.test("a cancel that read a running run which has since parked releases its lock", async () => {
  await withTemp(async (dir) => {
    const store = new StaleOnce(`${dir}/runs`, defaultStateHost);
    const id = await parkRollout(store);
    const loaded = await store.getRun(id);
    if (loaded === null) throw new Error("no record");
    const stale = structuredClone(loaded);
    stale.record.status = "running";
    stale.version = "stale";
    store.stale = stale;
    await cancelRun(new Rollout(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals((await recordOf(store, id)).status, "cancelled");
    assertEquals(await isFree(store), true);
  });
});

Deno.test("a run-held claim against a sibling's target-scoped hold names the run itself", async () => {
  await withTempStore(async (store) => {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    class B extends Build {
      scoped = target()
        .lock((s) => s.key(KEY).withTtl("1h"))
        .executes(() => sleep(100));
      warmup = target().executes(() => sleep(20));
      held = target()
        .dependsOn(this.warmup)
        .lock((s) => s.key(KEY).withTtl("1h").holdForRun())
        .executes(() => {});
      all = target().dependsOn(this.scoped, this.held).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      parallel: true,
    });
    assertEquals(result.ok, false);
    assertStringIncludes(messageOf(result.error), "same run holds it");
    assertEquals(await isFree(store), true);
  });
});
