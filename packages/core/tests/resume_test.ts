import { assertEquals, assertRejects, messageOf } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { AlreadyResumedError, resumeCheck, resumeRun } from "../src/resume.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { externalSignal, resumeWhen } from "../src/wait.ts";

/** Run `fn` with a temp directory, cleaned up afterwards. */
async function withTempStore(
  fn: (store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("deploy → wait → promote survives across processes, exactly once", async () => {
  await withTempStore(async (store) => {
    let deployRuns = 0;
    let promoteRuns = 0;
    let approval: unknown;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(async (ctx) => {
          deployRuns += 1;
          await ctx.state.set({ at: "sit-7" });
        });
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("approved")));
        promote = target().dependsOn(this.gate).executes((ctx) => {
          promoteRuns += 1;
          approval = ctx.signals.get("approved")?.data;
        });
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };

    // Process A: runs deploy, suspends at the gate.
    const a = makeBuild();
    const resultA = await execute(a, a.promote, {
      silent: true,
      stateStore: store,
    });
    assertEquals(resultA.suspended, true);
    assertEquals(deployRuns, 1);
    assertEquals(promoteRuns, 0);
    const runId = (await store.listRuns({}))[0].id;

    // Processes B and C resume concurrently with the signal — exactly one wins,
    // the loser gets AlreadyResumedError.
    const b = makeBuild();
    const c = makeBuild();
    const outcomes = await Promise.allSettled([
      resumeRun(b, {
        runId,
        signal: "approved",
        data: { by: "qa" },
        silent: true,
        stateStore: store,
      }),
      resumeRun(c, {
        runId,
        signal: "approved",
        data: { by: "qa" },
        silent: true,
        stateStore: store,
      }),
    ]);
    // Exactly one resumer succeeds; the other is rejected (it either lost the
    // CAS mid-run → AlreadyResumedError, or arrived after completion).
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    assertEquals(fulfilled.length, 1);
    assertEquals(rejected.length, 1);

    // promote ran exactly once, with the delivered payload; deploy never re-ran.
    assertEquals(promoteRuns, 1);
    assertEquals(deployRuns, 1);
    assertEquals(approval, { by: "qa" });

    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "succeeded");
    assertEquals(loaded?.record.targets.promote.status, "succeeded");
    assertEquals(loaded?.record.targets.gate.status, "succeeded");
    assertEquals(loaded?.record.targets.deploy.meta.at, "sit-7"); // state carried across
  });
});

Deno.test("resumeRun errors on a missing or non-suspended run", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      go = target().executes(() => {});
    }
    const b = new B();
    discoverTargets(b);

    await assertRejects(
      () => resumeRun(b, { runId: "nope", stateStore: store, silent: true }),
      Error,
      "no run",
    );

    // A completed run cannot be resumed.
    await execute(b, b.go, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;
    await assertRejects(
      () => resumeRun(b, { runId, stateStore: store, silent: true }),
      Error,
      "not suspended",
    );
  });
});

Deno.test("resumeRun rejects a drifted graph unless forced", async () => {
  await withTempStore(async (store) => {
    class Suspends extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new Suspends();
    discoverTargets(a);
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // A build whose graph gained a dependency drifts from the record.
    class Drifted extends Build {
      extra = target().executes(() => {});
      gate = target().dependsOn(this.extra).waitsFor((s) =>
        s.on(externalSignal("go"))
      );
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const drifted = new Drifted();
    discoverTargets(drifted);
    await assertRejects(
      () =>
        resumeRun(drifted, {
          runId,
          signal: "go",
          stateStore: store,
          silent: true,
        }),
      Error,
      "graph changed",
    );
    // --force-graph overrides it.
    const forced = new Drifted();
    discoverTargets(forced);
    const result = await resumeRun(forced, {
      runId,
      signal: "go",
      stateStore: store,
      forceGraph: true,
      silent: true,
    });
    assertEquals(result.ok, true);
  });
});

Deno.test("resumeRun times out a wait past its deadline", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      // A zero-length deadline is already past by the time we resume.
      gate = target().waitsFor((s) => s.on(externalSignal("never")).timeout(0));
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new B();
    discoverTargets(a);
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    const resumer = new B();
    discoverTargets(resumer);
    const result = await resumeRun(resumer, {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, false);
    assertEquals(messageOf(result.error).includes("timed out"), true);
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "failed");
    assertEquals(loaded?.record.targets.gate.status, "failed");
  });
});

Deno.test("resuming a run already running gives AlreadyResumedError", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new B();
    discoverTargets(a);
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // Simulate another process having already resumed it: move it to `running`.
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("expected the suspended run");
    const running = {
      ...loaded.record,
      status: "running" as const,
      actor: "bob",
    };
    const put = await store.putRun(running, loaded.version);
    if (!put.ok) throw new Error("expected the status write to land");

    const resumer = new B();
    discoverTargets(resumer);
    const error = await assertRejects(
      () =>
        resumeRun(resumer, {
          runId,
          signal: "go",
          stateStore: store,
          silent: true,
        }),
      AlreadyResumedError,
      "already resumed by bob",
    );
    assertEquals(error instanceof AlreadyResumedError && error.runId, runId);
  });
});

Deno.test("resumeCheck isolates a per-run error and keeps sweeping", async () => {
  await withTempStore(async (store) => {
    let ready = false;
    let ran = false;
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(resumeWhen(() => ready)));
        work = target().dependsOn(this.gate).executes(() => void (ran = true));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    // A normal run that suspends now (predicate false) and resumes in the sweep.
    const a = makeBuild();
    await execute(a, a.work, { silent: true, stateStore: store });

    // A broken suspended run whose root target the build lacks → resumeRun throws.
    // It is newer, so the sweep hits it first; the old behaviour would re-throw
    // and strand the good run behind it.
    const now = new Date().toISOString();
    await store.putRun({
      id: "broken",
      build: "B",
      rootTarget: "ghost",
      status: "suspended" as const,
      actor: "x",
      createdAt: now,
      updatedAt: now,
      graph: [{ name: "ghost", dependsOn: [] }],
      params: {},
      targets: { ghost: { status: "waiting", meta: {} } },
      signals: {},
      events: [],
    }, null);

    ready = true; // the good run's predicate is now satisfied
    const result = await resumeCheck(makeBuild(), {
      stateStore: store,
      silent: true,
    });
    assertEquals(result.checked, 2); // both were checked
    assertEquals(result.failed >= 1, true); // the broken one counted as failed
    assertEquals(ran, true); // the good run still ran despite the broken one
  });
});

Deno.test("resumeCheck sweeps suspended runs and advances satisfied predicates", async () => {
  await withTempStore(async (store) => {
    let ready = false;
    let ran = false;
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(resumeWhen(() => ready)));
        work = target().dependsOn(this.gate).executes(() => void (ran = true));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };

    // Suspend with the predicate false.
    const a = makeBuild();
    const resultA = await execute(a, a.work, {
      silent: true,
      stateStore: store,
    });
    assertEquals(resultA.suspended, true);
    assertEquals(ran, false);

    // A check while the predicate is still false re-suspends; work stays un-run.
    const first = await resumeCheck(makeBuild(), {
      stateStore: store,
      silent: true,
    });
    assertEquals(first.checked, 1);
    assertEquals(first.failed, 0);
    assertEquals(ran, false);

    // Flip the predicate → the next check advances the run to completion.
    ready = true;
    const second = await resumeCheck(makeBuild(), {
      stateStore: store,
      silent: true,
    });
    assertEquals(second.failed, 0);
    assertEquals(ran, true);
  });
});
