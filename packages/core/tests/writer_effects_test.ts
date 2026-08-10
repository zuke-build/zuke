/**
 * Unit tests for the writer's effect methods — the durable intent that has to
 * land *before* an effect's body runs, and the guard that stops a stale process
 * writing one onto a run somebody else already settled.
 *
 * @module
 */

import { assertEquals, assertRejects } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { execute } from "../src/executor.ts";
import { target } from "../src/target.ts";
import { Redactor } from "../src/redact.ts";
import { RunNotActiveError, RunStateWriter } from "../src/state/writer.ts";
import type { StateStore } from "../src/state/store.ts";
import type { EffectState, RunRecord, RunStatus } from "../src/state/types.ts";

const NOW = "2026-08-10T10:00:00.000Z";

/** A minimal run record with one target. */
function sampleRecord(status: RunStatus = "running"): RunRecord {
  return {
    id: "run-1",
    build: "Ci",
    rootTarget: "gate",
    status,
    actor: "tester",
    createdAt: NOW,
    updatedAt: NOW,
    graph: [{ name: "gate", dependsOn: [] }],
    params: {},
    targets: { gate: { status: "pending", meta: {} } },
    signals: {},
    events: [],
  };
}

/** An in-memory store whose failure modes each test drives directly. */
class MemStore implements StateStore {
  record: RunRecord | null = null;
  version = 0;
  /** Reject the next put with a store error. */
  failNextPut = false;
  /** Answer this many puts with a conflict before accepting one. */
  forceConflicts = 0;
  /** Return null from getRun, as though the run were pruned mid-write. */
  vanish = false;
  /** What a conflicting re-read reports the run's status as. */
  freshStatus?: RunStatus;

  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getRun(): Promise<{ record: RunRecord; version: string } | null> {
    if (this.vanish || this.record === null) return Promise.resolve(null);
    const record = structuredClone(this.record);
    if (this.freshStatus !== undefined) record.status = this.freshStatus;
    return Promise.resolve({ record, version: String(this.version) });
  }
  putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: true }> {
    if (this.failNextPut) {
      this.failNextPut = false;
      return Promise.reject(new Error("store down"));
    }
    if (this.forceConflicts > 0) {
      this.forceConflicts -= 1;
      return Promise.resolve({ ok: false, conflict: true });
    }
    const current = this.record === null ? null : String(this.version);
    if (current !== expected) {
      return Promise.resolve({ ok: false, conflict: true });
    }
    this.record = structuredClone(record);
    this.version += 1;
    return Promise.resolve({ ok: true, version: String(this.version) });
  }
  deleteRun(): Promise<void> {
    this.record = null;
    return Promise.resolve();
  }
  acquireLock(): Promise<never> {
    throw new Error("MemStore: locks are unused here");
  }
  renewLock(): Promise<never> {
    throw new Error("MemStore: locks are unused here");
  }
  releaseLock(): Promise<never> {
    throw new Error("MemStore: locks are unused here");
  }
}

/** A writer over `store`, seeded with a record in `status`. */
async function writerFor(
  store: MemStore,
  status: RunStatus = "running",
  onExternalCancel?: () => void,
): Promise<RunStateWriter> {
  const redactor = new Redactor();
  redactor.add("swordfish");
  return await RunStateWriter.open(
    store,
    sampleRecord(status),
    () => NOW,
    redactor,
    undefined,
    onExternalCancel,
  );
}

/** The persisted effect row, or undefined. */
function effectOf(store: MemStore, name = "post"): EffectState | undefined {
  return store.record?.targets["gate"]?.effects?.[name];
}

Deno.test("beginEffect arms the intent and says to run", async () => {
  const store = new MemStore();
  const writer = await writerFor(store);
  assertEquals(await writer.beginEffect("gate", "post"), "run");
  // Persisted, not merely in memory: the point is that a later process can see
  // the effect was owed.
  assertEquals(effectOf(store)?.status, "pending");
  assertEquals(effectOf(store)?.intentAt, NOW);
  assertEquals(effectOf(store)?.attempts, 1);
});

Deno.test("an effect already done is skipped rather than repeated", async () => {
  const store = new MemStore();
  const writer = await writerFor(store);
  await writer.beginEffect("gate", "post");
  await writer.markEffectSettled("gate", "post", true);
  assertEquals(await writer.beginEffect("gate", "post"), "skip");
  // The row is untouched by the skip — still one attempt, still done.
  assertEquals(effectOf(store)?.status, "done");
  assertEquals(effectOf(store)?.attempts, 1);
});

Deno.test("a failed effect is re-armed, keeping its first intent time", async () => {
  const store = new MemStore();
  let clock = "2026-08-10T10:00:00.000Z";
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => clock,
    new Redactor(),
  );
  await writer.beginEffect("gate", "post");
  await writer.markEffectSettled("gate", "post", false, "boom");
  assertEquals(effectOf(store)?.status, "failed");
  assertEquals(effectOf(store)?.error, "boom");

  clock = "2026-08-10T11:00:00.000Z";
  assertEquals(await writer.beginEffect("gate", "post"), "run");
  assertEquals(effectOf(store)?.status, "pending");
  assertEquals(effectOf(store)?.attempts, 2);
  // intentAt is when the effect was first owed, not when it was last tried —
  // it dates the obligation, and a later attempt does not reset it.
  assertEquals(effectOf(store)?.intentAt, "2026-08-10T10:00:00.000Z");
});

Deno.test("a settled effect records when, and a failure's message is redacted", async () => {
  const store = new MemStore();
  const writer = await writerFor(store);
  await writer.beginEffect("gate", "post");
  await writer.markEffectSettled("gate", "post", false, "token swordfish bad");
  assertEquals(effectOf(store)?.settledAt, NOW);
  assertEquals(effectOf(store)?.error?.includes("swordfish"), false);
});

Deno.test("an effect is refused on a run that is no longer running", async () => {
  // The one that matters. A process can be alive holding a stale view of a run
  // a sweeper already settled; arming an effect there would let it publish a
  // result over the one the settler already published — for a merge gate, a
  // green check over a red one.
  const settled: RunStatus[] = [
    "cancelling",
    "cancelled",
    "failed",
    "succeeded",
  ];
  for (const status of settled) {
    const store = new MemStore();
    const writer = await writerFor(store, status);
    const error = await assertRejects(
      () => writer.beginEffect("gate", "post"),
      RunNotActiveError,
      "not running",
    );
    if (!(error instanceof RunNotActiveError)) throw new Error("wrong type");
    assertEquals(error.status, status);
    assertEquals(error.runId, "run-1");
    // Nothing was armed, so nothing will run.
    assertEquals(effectOf(store), undefined);
  }
});

Deno.test("a conflicting re-read that has been settled elsewhere is refused too", async () => {
  // The window the best-effort path handles by re-applying onto the settling
  // record and carrying on. For an effect that is exactly wrong.
  const store = new MemStore();
  let cancelled = 0;
  const guarded = await writerFor(store, "running", () => void cancelled++);
  store.forceConflicts = 1;
  store.freshStatus = "cancelling";
  await assertRejects(
    () => guarded.beginEffect("gate", "post"),
    RunNotActiveError,
  );
  // The executor is told to stop, rather than only being refused.
  assertEquals(cancelled, 1);
});

Deno.test("a vanished run refuses the effect rather than dropping the write", async () => {
  // The best-effort path drops this one with a warning. Doing that here would
  // run a side effect that nothing recorded as owed.
  const store = new MemStore();
  const writer = await writerFor(store);
  store.forceConflicts = 1;
  store.vanish = true;
  await assertRejects(
    () => writer.beginEffect("gate", "post"),
    Error,
    "vanished",
  );
});

Deno.test("exhausting the retries refuses the effect", async () => {
  const store = new MemStore();
  const writer = await writerFor(store);
  store.forceConflicts = 99; // every attempt conflicts
  await assertRejects(
    () => writer.beginEffect("gate", "post"),
    Error,
    "conflicting writes",
  );
});

Deno.test("a store error refuses the effect", async () => {
  const store = new MemStore();
  const writer = await writerFor(store);
  store.failNextPut = true;
  await assertRejects(
    () => writer.beginEffect("gate", "post"),
    Error,
    "store down",
  );
});

Deno.test("a refused effect does not poison the writer's other writes", async () => {
  // Every write shares one serialising chain. A rejected effect write that was
  // left on it would make each later best-effort write reject too, so one
  // failed intent would take the run's whole bookkeeping down with it.
  const store = new MemStore();
  const writer = await writerFor(store);
  store.failNextPut = true;
  await assertRejects(() => writer.beginEffect("gate", "post"), Error);

  await writer.markTargetSettled("gate", "passed");
  assertEquals(store.record?.targets["gate"]?.status, "succeeded");
  assertEquals(await writer.beginEffect("gate", "post"), "run");
  assertEquals(effectOf(store)?.status, "pending");
});

Deno.test("a run with state disabled refuses to start a build that declares an effect", async () => {
  // With nowhere to record the intent there is nothing for a later process to
  // re-drive from, which is the entire guarantee — so the run is refused rather
  // than performing a side effect nothing knows was owed.
  let ran = false;
  class B extends Build {
    gate = target().effect("post", () => {
      ran = true;
    });
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.gate, { silent: true, stateStore: false });
  assertEquals(result.ok, false);
  assertEquals(ran, false);
});
