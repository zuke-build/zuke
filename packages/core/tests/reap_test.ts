// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { reapAbandoned, recoverStranded } from "../src/reap.ts";
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
  buildId?: string,
): Parameters<typeof reapAbandoned>[0] {
  const build = new Cd();
  discoverTargets(build);
  return {
    build,
    store,
    actor: "sweeper",
    reporter,
    now: () => now,
    ...(buildId === undefined ? {} : { buildId }),
  };
}

/** Rewrite the seeded record with `mutate` applied. */
async function amend(
  store: FileSystemStateStore,
  id: string,
  mutate: (record: RunRecord) => void,
): Promise<void> {
  const loaded = await store.getRun(id);
  if (loaded === null) throw new Error("seed missing");
  const next = structuredClone(loaded.record);
  mutate(next);
  assertEquals((await store.putRun(next, loaded.version)).ok, true);
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

Deno.test("a live run past its deadline is left to whoever is running it", async () => {
  // The ordering that keeps this safe. Settling a run whose process is still
  // working would run its compensations beside the work they undo, and leave a
  // live process reporting on a run somebody else had ended. Every case the
  // deadline exists for has no live holder, so nothing it should catch escapes.
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      const held = await store.acquireLock(
        lockKey(RUN_LEASE_PREFIX, "run-1"),
        { actor: "the-owner", runId: "run-1", since: NOW },
        60_000,
      );
      assertEquals(held.ok, true);

      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
      assertEquals((await store.getRun("run-1"))?.record.status, "running");
    },
  );
});

Deno.test("another build's runs are not touched", async () => {
  // A store is commonly shared, and a listing has no build filter. Acting on
  // another build's run is worse than useless: its targets are not in this
  // build, so a settlement finds no compensations, stamps the record terminal
  // with the run's side effects never unwound, and nothing retries it.
  await withStore([record("foreign", "running")], async (store) => {
    const loaded = await store.getRun("foreign");
    if (loaded === null) throw new Error("seed missing");
    const foreign = structuredClone(loaded.record);
    foreign.build = "SomeOtherBuild";
    assertEquals((await store.putRun(foreign, loaded.version)).ok, true);

    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
    assertEquals((await store.getRun("foreign"))?.record.status, "running");
  });
});

Deno.test("another build's stranded run is not settled either", async () => {
  await withStore([record("foreign", "cancelling")], async (store) => {
    const loaded = await store.getRun("foreign");
    if (loaded === null) throw new Error("seed missing");
    const foreign = structuredClone(loaded.record);
    foreign.build = "SomeOtherBuild";
    assertEquals((await store.putRun(foreign, loaded.version)).ok, true);

    const { reporter } = capturing();
    const outcome = await recoverStranded(depsFor(store, reporter));
    assertEquals(outcome.settled, []);
    assertEquals((await store.getRun("foreign"))?.record.status, "cancelling");
  });
});

Deno.test("a stranded run is recovered for a single-run sweep too", async () => {
  // A plane that sweeps one run at a time is exactly the one that would
  // otherwise never recover it, since nothing else looks at `cancelling`.
  await withStore([record("run-1", "cancelling")], async (store) => {
    const { reporter } = capturing();
    const outcome = await recoverStranded({
      ...depsFor(store, reporter),
      runId: "run-1",
    });
    assertEquals(outcome.settled, ["run-1"]);
    assertEquals((await store.getRun("run-1"))?.record.status, "cancelled");
  });
});

Deno.test("a same-named build without the run's root target is not ours", async () => {
  // A class name is not an identity: `Ci` is a name half the repos in an
  // organisation will use, and a shared store holds all of their runs. The root
  // target has to be here too, because that is what makes the compensations a
  // settlement would run resolvable.
  await withStore([record("foreign", "running")], async (store) => {
    const loaded = await store.getRun("foreign");
    if (loaded === null) throw new Error("seed missing");
    const foreign = structuredClone(loaded.record);
    foreign.rootTarget = "someone-elses-target";
    assertEquals((await store.putRun(foreign, loaded.version)).ok, true);

    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
    assertEquals((await store.getRun("foreign"))?.record.status, "running");
  });
});

Deno.test("a stranded run settles into the terminal its settlement intended", async () => {
  // `recoverStranded` names `cancelled` as a default, and the record overrides
  // it: the process that began the settlement recorded what it meant, and this
  // one is not it.
  await withStore([record("run-1", "cancelling")], async (store) => {
    const loaded = await store.getRun("run-1");
    if (loaded === null) throw new Error("seed missing");
    const intended = structuredClone(loaded.record);
    intended.intendedTerminal = "failed";
    assertEquals((await store.putRun(intended, loaded.version)).ok, true);

    const { reporter } = capturing();
    const outcome = await recoverStranded(depsFor(store, reporter));
    assertEquals(outcome.settled, ["run-1"]);
    // `failed`, not the `cancelled` the call named: a sweep was failing this run.
    assertEquals((await store.getRun("run-1"))?.record.status, "failed");
  });
});

Deno.test("a colliding build with a different graph does not settle the run", async () => {
  // Same class name, same root-target name, different graph — the residual the
  // name-and-root check cannot see. Settling is irreversible and skips
  // compensations it cannot resolve, so it asks the stricter question.
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      const loaded = await store.getRun("run-1");
      if (loaded === null) throw new Error("seed missing");
      const other = structuredClone(loaded.record);
      // Another repo's `Cd`, whose `deploy` depends on something this one has not
      // got.
      other.graph = [
        { name: "build", dependsOn: [] },
        { name: "deploy", dependsOn: ["build"] },
      ];
      assertEquals((await store.putRun(other, loaded.version)).ok, true);

      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      // Not settled. It is still handed back, because that is reversible and a
      // resume refuses a graph it does not recognise with a clear error.
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, ["run-1"]);
    },
  );
});

Deno.test("a colliding build with a different graph does not finish a stranded run", async () => {
  await withStore([record("run-1", "cancelling")], async (store) => {
    const loaded = await store.getRun("run-1");
    if (loaded === null) throw new Error("seed missing");
    const other = structuredClone(loaded.record);
    other.graph = [
      { name: "build", dependsOn: [] },
      { name: "deploy", dependsOn: ["build"] },
    ];
    assertEquals((await store.putRun(other, loaded.version)).ok, true);

    const { reporter } = capturing();
    const outcome = await recoverStranded(depsFor(store, reporter));
    assertEquals(outcome.settled, []);
    // Left for the build that recognises it.
    assertEquals((await store.getRun("run-1"))?.record.status, "cancelling");
  });
});

Deno.test("a run from another origin is not touched, whatever its shape", async () => {
  // The case the shape checks cannot see: one `zuke.ts` templated across two
  // services, so the class name, the root target and the graph all agree and
  // only the target bodies differ. The recorded origin is what separates them.
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      await amend(store, "run-1", (r) => {
        r.buildId = "acme/web";
      });
      const { reporter } = capturing();
      const outcome = await reapAbandoned(
        depsFor(store, reporter, NOW, "acme/api"),
      );
      // Neither settled for its deadline nor handed back — a resume of it would
      // run this build's bodies against the other service's run.
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, []);
      assertEquals((await store.getRun("run-1"))?.record.status, "running");
    },
  );
});

Deno.test("a stranded run from another origin is left for its own build", async () => {
  await withStore([record("run-1", "cancelling")], async (store) => {
    await amend(store, "run-1", (r) => {
      r.buildId = "acme/web";
    });
    const { reporter } = capturing();
    const outcome = await recoverStranded(
      depsFor(store, reporter, NOW, "acme/api"),
    );
    assertEquals(outcome.settled, []);
    assertEquals((await store.getRun("run-1"))?.record.status, "cancelling");
  });
});

Deno.test("a run with no recorded origin is still reaped", async () => {
  // The retrofit's whole safety: a record written before the field existed has
  // no origin, and a sweep that refused it would leave the effects it owed
  // never driven at all.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter } = capturing();
    const outcome = await reapAbandoned(
      depsFor(store, reporter, NOW, "acme/api"),
    );
    assertEquals(outcome.reaped, ["run-1"]);
    assertEquals((await store.getRun("run-1"))?.record.status, "suspended");
  });
});

Deno.test("a sweep with no origin of its own still reaps a run that has one", async () => {
  // The mirror case: a process outside CI that sets no ZUKE_BUILD_ID cannot
  // claim to be a different build, so it must not refuse on that basis.
  await withStore([record("run-1", "running")], async (store) => {
    await amend(store, "run-1", (r) => {
      r.buildId = "acme/api";
    });
    const { reporter } = capturing();
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome.reaped, ["run-1"]);
  });
});

Deno.test("a run from the same origin is reaped normally", async () => {
  await withStore([record("run-1", "running")], async (store) => {
    await amend(store, "run-1", (r) => {
      r.buildId = "acme/api";
    });
    const { reporter } = capturing();
    const outcome = await reapAbandoned(
      depsFor(store, reporter, NOW, "acme/api"),
    );
    assertEquals(outcome.reaped, ["run-1"]);
  });
});

Deno.test("a shared origin does not make another build's run ours", async () => {
  // Two builds in one repository resolve the same `GITHUB_REPOSITORY`, so the
  // origin abstains between them. It only ever narrows what the shape checks
  // permit — it can refuse a run, never claim one — so the build name still
  // separates them, exactly as before origins existed.
  await withStore([record("run-1", "running")], async (store) => {
    await amend(store, "run-1", (r) => {
      r.build = "OtherBuild";
      r.buildId = "acme/api";
    });
    const { reporter } = capturing();
    const outcome = await reapAbandoned(
      depsFor(store, reporter, NOW, "acme/api"),
    );
    assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
    assertEquals((await store.getRun("run-1"))?.record.status, "running");
  });
});

Deno.test("one bad stranded run does not strand the rest of the recovery", async () => {
  // The same isolation the abandoned sweep has, on the stranded path: a store
  // hiccup on one `cancelling` record must not leave every other one stuck.
  await withStore(
    [record("bad", "cancelling"), record("good", "cancelling")],
    async (store) => {
      const { reporter, lines } = capturing();
      const realGet = store.getRun.bind(store);
      store.getRun = (id: string) =>
        id === "bad"
          ? Promise.reject(new Error("the store hiccuped"))
          : realGet(id);
      const outcome = await recoverStranded(depsFor(store, reporter));
      assertEquals(outcome.failed, 1);
      assertEquals(outcome.settled, ["good"]);
      assertEquals((await realGet("good"))?.record.status, "cancelled");
      assertEquals(
        lines.some((l) =>
          l.includes("stranded run bad") && l.includes("the store hiccuped")
        ),
        true,
      );
    },
  );
});

Deno.test("a run settled between the reaper's re-read and its write is left alone", async () => {
  // Later than the window the earlier test closes: the run was still running
  // at the re-read under the lease, and a canceller settled it during the
  // suspend write's own compare-and-swap loop. The CAS notices and the reaper
  // walks away instead of writing `suspended` over a terminal record.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter } = capturing();
    const deps = depsFor(store, reporter);
    const realGet = store.getRun.bind(store);
    let asked = 0;
    // Call 1: the listing's examine. Call 2: the re-read under the lease.
    // Call 3: the suspend CAS's read — by then, a canceller has settled it.
    store.getRun = async (id: string) => {
      const got = await realGet(id);
      if (++asked === 3 && got !== null) {
        const settled = structuredClone(got.record);
        settled.status = "cancelled";
        await store.putRun(settled, got.version);
        return await realGet(id);
      }
      return got;
    };
    const outcome = await reapAbandoned(deps);
    assertEquals(outcome, { reaped: [], settled: [], failed: 0 });
    assertEquals((await realGet("run-1"))?.record.status, "cancelled");
  });
});

Deno.test("a store that never accepts the suspend write is reported, not looped", async () => {
  // Bounded retries: a permanent conflict becomes one counted, named failure —
  // the sweep carries on, and the lease is not kept.
  await withStore([record("run-1", "running")], async (store) => {
    const { reporter, lines } = capturing();
    const realPut = store.putRun.bind(store);
    store.putRun = (
      next: RunRecord,
      expected: string | null,
    ) =>
      next.status === "suspended"
        ? Promise.resolve({ ok: false, conflict: true })
        : realPut(next, expected);
    const outcome = await reapAbandoned(depsFor(store, reporter));
    assertEquals(outcome.failed, 1);
    assertEquals(outcome.reaped, []);
    assertEquals(
      lines.some((l) => l.includes("gave up returning run-1 to suspended")),
      true,
    );
    // The question-lease was still released on the way out.
    const free = await store.acquireLock(
      lockKey(RUN_LEASE_PREFIX, "run-1"),
      { actor: "next-sweep", runId: "run-1", since: NOW },
      60_000,
    );
    assertEquals(free.ok, true);
  });
});

Deno.test("a recorded graph with a different node name is not settled", async () => {
  // Same node count as this build's plan, but the names disagree — the
  // residual a length check alone cannot see. Handed back, never settled.
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      await amend(store, "run-1", (r) => {
        r.graph = [{ name: "other", dependsOn: [] }];
      });
      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, ["run-1"]);
    },
  );
});

Deno.test("a recorded graph with a different dependency count is not settled", async () => {
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      // The recorded `deploy` depended on something; this build's does not.
      await amend(store, "run-1", (r) => {
        r.graph = [{ name: "deploy", dependsOn: ["build"] }];
      });
      const { reporter } = capturing();
      const outcome = await reapAbandoned(depsFor(store, reporter));
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, ["run-1"]);
    },
  );
});

Deno.test("a recorded graph with re-wired dependencies is not settled", async () => {
  // Node names and dependency counts all match; only the edges point at
  // different targets. Still another build's run for settling purposes.
  class Pipeline extends Build {
    prep = target().unlisted().executes(() => {});
    deploy = target().dependsOn(this.prep).executes(() => {});
  }
  await withStore(
    [record("run-1", "running", "2026-08-10T11:00:00.000Z")],
    async (store) => {
      await amend(store, "run-1", (r) => {
        r.build = "Pipeline";
        r.graph = [
          { name: "prep", dependsOn: [] },
          // Same length as the planned `deploy → prep`, different edge.
          { name: "deploy", dependsOn: ["other"] },
        ];
      });
      const build = new Pipeline();
      discoverTargets(build);
      const { reporter } = capturing();
      const outcome = await reapAbandoned({
        build,
        store,
        actor: "sweeper",
        reporter,
        now: () => NOW,
      });
      assertEquals(outcome.settled, []);
      assertEquals(outcome.reaped, ["run-1"]);
    },
  );
});
