/**
 * Unit tests for reaping — deciding, for a run that claims to be running,
 * whether anyone is still there.
 *
 * The decisions under test are the ones with consequences: leaving a slow run
 * alone, releasing a dead one, settling one that has run out of time, and never
 * moving a run somebody else has already settled.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { reapAbandoned } from "../src/reap.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { RUN_LEASE_PREFIX } from "../src/state/run_lease.ts";
import { lockKey } from "../src/state/lock.ts";
import type { Reporter } from "../src/executor.ts";
import type { RunRecord, RunStatus } from "../src/state/types.ts";

const NOW = "2026-08-10T12:00:00.000Z";

/** A build whose one target has a compensation, so settling has work to do. */
class Cd extends Build {
  rollback = target().unlisted().executes(() => {});
  deploy = target().onCancel(this.rollback).executes(() => {});
}

/** A silent reporter that keeps what it was told. */
function capturing(): { reporter: Reporter; lines: string[] } {
  const lines: string[] = [];
  return {
    reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    lines,
  };
}

/** A record in `status`, with `deploy` recorded as having succeeded. */
function record(id: string, status: RunStatus, deadlineAt?: string): RunRecord {
  return {
    id,
    build: "Cd",
    rootTarget: "deploy",
    status,
    actor: "runner",
    createdAt: NOW,
    updatedAt: NOW,
    graph: [{ name: "deploy", dependsOn: [] }],
    params: {},
    targets: { deploy: { status: "succeeded", meta: {} } },
    signals: {},
    events: [],
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
  };
}

/** Run `fn` against a temp store seeded with `seed`. */
async function withStore(
  seed: RunRecord[],
  fn: (store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    for (const r of seed) assertEquals((await store.putRun(r, null)).ok, true);
    await fn(store);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** The reap dependencies for `store`, at a fixed time. */
function depsFor(
  store: FileSystemStateStore,
  reporter: Reporter,
  now = NOW,
): Parameters<typeof reapAbandoned>[0] {
  const build = new Cd();
  discoverTargets(build);
  return { build, store, actor: "sweeper", reporter, now: () => now };
}

Deno.test("a run whose holder is still there is left alone", async () => {
  // The distinction the whole thing rests on: a live holder keeps renewing, so
  // a lease that cannot be taken means the run is slow, not dead.
  await withStore([record("run-1", "running")], async (store) => {
    const held = await store.acquireLock(
      lockKey(RUN_LEASE_PREFIX, "run-1"),
      { actor: "the-owner", runId: "run-1", since: NOW },
      60_000,
    );
    assertEquals(held.ok, true);

    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome, { reaped: [], settled: [], failed: 0 });

    const after = await store.getRun("run-1");
    assertEquals(after?.record.status, "running"); // untouched
  });
});

Deno.test("a run whose holder is gone goes back to suspended", async () => {
  // Nothing holds its lease, so the process that was driving it is gone. The
  // run becomes resumable rather than being settled: its work may still be owed.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter, lines } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome.reaped, ["run-1"]);
    assertEquals(outcome.settled, []);

    const after = await store.getRun("run-1");
    assertEquals(after?.record.status, "suspended");
    const event = after?.record.events.find((e) => e.tool === "reap");
    assertEquals(event?.actor, "sweeper");
    assertEquals(event?.outcome, "ok");
    assertEquals(
      lines.some((l) => l.includes("returning it to suspended")),
      true,
    );
  });
});

Deno.test("the reaper does not keep the lease it used to ask the question", async () => {
  // It only acquired one to find out whether anyone else had it. Holding on
  // would make the resumer that follows refuse the run it just freed.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter } = capturing();
    await reapAbandoned(depsFor(store, reporter));
    const free = await store.acquireLock(
      lockKey(RUN_LEASE_PREFIX, "run-1"),
      { actor: "the-resumer", runId: "run-1", since: NOW },
      60_000,
    );
    assertEquals(free.ok, true);
  });
});

Deno.test("a run past its deadline is settled failed, with its compensations", async () => {
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      const { reporter, lines } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome.settled, ["run-1"]);
      assertEquals(outcome.reaped, []);

      const after = await store.getRun("run-1");
      // `failed`, not `cancelled`: it ran out of time, nobody asked it to stop.
      assertEquals(after?.record.status, "failed");
      // And its side effects were unwound, exactly as a cancel would.
      const compensated = after?.record.events.filter((e) =>
        e.tool === "compensate"
      );
      assertEquals(compensated?.length, 1);
      assertEquals(lines.some((l) => l.includes("passed its deadline")), true);
    },
  );
});

Deno.test("a deadline is only past when it is actually past", async () => {
  await withStore(
    [record("run-1", "running", "2026-08-10T13:00:00.000Z")],
    async (store) => {
      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      // An hour of budget left: reaped as ownerless, not settled as expired.
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, ["run-1"]);
    },
  );
});

Deno.test("a malformed deadline is not treated as a passed one", async () => {
  // Refusing to guess beats settling a healthy run because a timestamp was junk.
  await withStore([record("run-1", "running", "not-a-date")], async (store) => {
    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome.settled, []);
    assertEquals(outcome.reaped, ["run-1"]);
  });
});

Deno.test("a run with no deadline is never settled for time", async () => {
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome.settled, []);
  });
});

Deno.test("only running runs are examined", async () => {
  await withStore(
    [
      record("done", "succeeded"),
      record("waiting", "suspended"),
      record("stopping", "cancelling"),
    ],
    async (store) => {
      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
      assertEquals((await store.getRun("waiting"))?.record.status, "suspended");
    },
  );
});

Deno.test("a run settled between the lease and the write is left as it was found", async () => {
  // The window this closes: the reaper takes the lease of a run with no holder,
  // and a canceller settles it before the reaper writes. Moving it then would
  // undo the canceller's work.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter } = capturing();
    const deps = depsFor(store, reporter);
    // Settle it the moment the reaper asks for the record.
    const realGet = store.getRun.bind(store);
    let asked = 0;
    store.getRun = async (id: string) => {
      const got = await realGet(id);
      if (++asked === 2 && got !== null) {
        const settled = structuredClone(got.record);
        settled.status = "cancelled";
        await store.putRun(settled, got.version);
        return await realGet(id);
      }
      return got;
    };
    const outcome = await reapAbandoned(deps);
    assertEquals(outcome.reaped, []);
    assertEquals((await realGet("run-1"))?.record.status, "cancelled");
  });
});

Deno.test("one bad run does not strand the rest of the sweep", async () => {
  await withStore(
    [record("bad", "running"), record("good", "running")],
    async (store) => {
      const { reporter, lines } = capturing();
      const realGet = store.getRun.bind(store);
      store.getRun = (id: string) =>
        id === "bad"
          ? Promise.reject(new Error("the store hiccuped"))
          : realGet(id);
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome.failed, 1);
      assertEquals(outcome.reaped, ["good"]);
      assertEquals(lines.some((l) => l.includes("the store hiccuped")), true);
    },
  );
});
