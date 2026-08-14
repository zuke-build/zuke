// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects, messageOf } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import {
  AlreadyResumedError,
  resumeCheck,
  resumeRun,
  RunNotSuspendedError,
} from "../src/resume.ts";
import { ForeignRunError } from "../src/ownership.ts";
import { lockKey } from "../src/state/lock.ts";
import { RUN_LEASE_PREFIX } from "../src/state/run_lease.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost, type PutResult } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import { externalSignal, resumeWhen } from "../src/wait.ts";
import { withTemp } from "./_temp.ts";
import { withTempStore } from "./_store.ts";

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

/**
 * A store that makes every compare-and-swap write recording `deploy` as
 * `succeeded` conflict. A foreign writer winning `MAX_RETRIES` races in a row —
 * an MCP audit append, a concurrent `zuke cancel` — is how a record really goes
 * degraded: the writer exhausts its retries, adopts the freshly-read record and
 * permanently loses that settlement. No manufactured record shape is needed.
 */
class LosesDeploySettlement extends FileSystemStateStore {
  override putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    if (record.targets.deploy?.status === "succeeded") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expectedVersion);
  }
}

/**
 * Suspend a `deploy → gate → promote` run in `store`, losing `deploy`'s
 * settlement write for real. Returns the run id, a live log of what executed,
 * and a factory for a fresh build to resume with.
 */
async function suspendedDegradedRun(
  dir: string,
): Promise<{
  store: FileSystemStateStore;
  runId: string;
  log: string[];
  makeBuild: () => Build;
}> {
  const log: string[] = [];
  // A deploy behind a gate: the non-idempotent target a resume must not re-run
  // on a hunch.
  const makeBuild = () => {
    class CD extends Build {
      deploy = target().executes(() => void log.push("deploy"));
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on(externalSignal("approve"))
      );
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
    }
    const build = new CD();
    discoverTargets(build);
    return build;
  };
  const a = makeBuild();
  await execute(a, a.promote, {
    silent: true,
    stateStore: new LosesDeploySettlement(dir, defaultStateHost),
  });
  // Resume reads through a normal store; only the original run lost writes.
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runId = (await store.listRuns({}))[0].id;
  const loaded = await store.getRun(runId);
  if (loaded === null) throw new Error("expected the suspended run");
  // The lost write really did leave the record degraded, and really did leave a
  // succeeded target recorded as still running — the risk the refusal names.
  assertEquals(loaded.record.degraded, true);
  assertEquals(loaded.record.targets.deploy.status, "running");
  assertEquals(loaded.record.status, "suspended");
  return { store, runId, log, makeBuild };
}

Deno.test("resumeRun refuses a degraded record unless overridden", async () => {
  await withTemp(async (dir) => {
    const { store, runId, log, makeBuild } = await suspendedDegradedRun(
      `${dir}/runs`,
    );
    assertEquals(log, ["deploy"]);

    const error = await assertRejects(
      () =>
        resumeRun(makeBuild(), {
          runId,
          signal: "approve",
          stateStore: store,
          silent: true,
        }),
      Error,
      "degraded",
    );
    // Names the run, the concrete mechanism, the risk, and the override.
    assertEquals(messageOf(error).includes(runId), true);
    assertEquals(messageOf(error).includes(`"running"`), true);
    assertEquals(messageOf(error).includes("run a second time"), true);
    assertEquals(messageOf(error).includes("--resume-degraded"), true);
    // The refusal leaves the run suspended, so the override can still resume it.
    assertEquals((await store.getRun(runId))?.record.status, "suspended");

    const result = await resumeRun(makeBuild(), {
      runId,
      signal: "approve",
      stateStore: store,
      resumeDegraded: true,
      silent: true,
    });
    assertEquals(result.ok, true);
    // The override accepts the risk, and the risk is real: deploy succeeded but
    // is recorded `running`, so it runs a second time.
    assertEquals(log, ["deploy", "deploy", "promote"]);
  });
});

Deno.test("resume --check counts a degraded run as failed and reports why", async () => {
  await withTemp(async (dir) => {
    const { store, runId, makeBuild } = await suspendedDegradedRun(
      `${dir}/runs`,
    );
    const errors: string[] = [];
    // A sweep cannot decide whether a target is safe to repeat, so a degraded
    // run counts as failed — non-zero is the only channel a cron watches — and
    // the refusal is reported so the cause is visible rather than a bare count.
    const swept = await resumeCheck(makeBuild(), {
      stateStore: store,
      reporter: { info: () => {}, error: (m) => void errors.push(m) },
    });
    assertEquals(swept, { checked: 1, failed: 1 });
    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes(runId), true);
    assertEquals(errors[0].includes("--resume-degraded"), true);
    // It stays suspended, so a later sweep with the override still picks it up.
    assertEquals((await store.getRun(runId))?.record.status, "suspended");
    assertEquals(
      await resumeCheck(makeBuild(), {
        stateStore: store,
        resumeDegraded: true,
        silent: true,
      }),
      { checked: 1, failed: 0 },
    );
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

Deno.test("a resumed run's plugins observe it under the original run id (M7)", async () => {
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(externalSignal("go")));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    // Original run: suspends at the gate.
    const a = makeBuild();
    const first = await execute(a, a.done, { silent: true, stateStore: store });
    assertEquals(first.suspended, true);
    const runId = (await store.listRuns({}))[0].id;

    // Resume with a plugin: it sees the SAME run id and the run-state changes.
    const seen: { start?: string; states: string[] } = { states: [] };
    const resumed = await resumeRun(makeBuild(), {
      runId,
      signal: "go",
      stateStore: store,
      silent: true,
      plugins: [{
        onStart: (run) => void (seen.start = run.runId),
        onRunStateChange: (record) => void seen.states.push(record.status),
      }],
    });
    assertEquals(resumed.ok, true);
    assertEquals(seen.start, runId); // one identity across the suspend/resume
    assertEquals(seen.states, ["running", "succeeded"]);
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
      degraded: false,
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

Deno.test("a resume refuses a run another build owns", async () => {
  // The gap the shape checks leave: one `zuke.ts` templated across two services
  // agrees on every target name and edge, so the graph check passes and the
  // resume would run *this* service's bodies against the other's run. Only the
  // recorded origin separates them.
  await withTempStore(async (store) => {
    let promoted = 0;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(() => {});
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("approved")));
        promote = target().dependsOn(this.gate).executes(() => {
          promoted += 1;
        });
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const envOf = (id: string) => (name: string) =>
      name === "ZUKE_BUILD_ID" ? id : undefined;

    const a = makeBuild();
    const started = await execute(a, a.promote, {
      silent: true,
      stateStore: store,
      readEnv: envOf("acme/api"),
    });
    assertEquals(started.suspended, true);
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.buildId, "acme/api");

    const other = makeBuild();
    const error = await assertRejects(() =>
      resumeRun(other, {
        runId,
        signal: "approved",
        silent: true,
        stateStore: store,
        readEnv: envOf("acme/web"),
      }), ForeignRunError);
    assertEquals(messageOf(error).includes("acme/api"), true);
    // Nothing ran, and the run is exactly as it was left.
    assertEquals(promoted, 0);
    assertEquals((await store.getRun(runId))?.record.status, "suspended");
  });
});

Deno.test("a sweep skips another build's run without counting it failed", async () => {
  // A cron watches the failure count. Counting a run this build must not touch
  // would report a permanent non-zero result that no operator could ever clear.
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(() => {});
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("approved")));
        promote = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const envOf = (id: string) => (name: string) =>
      name === "ZUKE_BUILD_ID" ? id : undefined;

    const a = makeBuild();
    await execute(a, a.promote, {
      silent: true,
      stateStore: store,
      readEnv: envOf("acme/api"),
    });
    const runId = (await store.listRuns({}))[0].id;
    const before = await store.getRun(runId);

    const lines: string[] = [];
    const outcome = await resumeCheck(makeBuild(), {
      silent: true,
      stateStore: store,
      readEnv: envOf("acme/web"),
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    // Counted and reported once. A sweep that skipped everything in silence
    // would look exactly like one with nothing to do — which is how a mistyped
    // ZUKE_BUILD_ID would present: recovery quietly stops.
    assertEquals(
      lines.some((l) =>
        l.includes("skipped 1 run(s) belonging to another build") &&
        l.includes("acme/web")
      ),
      true,
    );
    assertEquals(outcome.checked, 1);
    assertEquals(outcome.failed, 0);
    // Skipped, not driven-and-re-suspended: the record was never written, so its
    // store version is the one the suspending process left. Comparing the status
    // alone would not tell the two apart — a foreign resume re-suspends at the
    // same gate and lands back on `suspended`.
    const after = await store.getRun(runId);
    assertEquals(after?.record.status, "suspended");
    assertEquals(after?.version, before?.version);
  });
});

Deno.test("a run recorded with no origin is still resumable", async () => {
  // The retrofit's safety: a record written before the field existed has no
  // origin, and a resume that refused it would strand whatever it owed.
  await withTempStore(async (store) => {
    let promoted = 0;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(() => {});
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("approved")));
        promote = target().dependsOn(this.gate).executes(() => {
          promoted += 1;
        });
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };

    const a = makeBuild();
    // No origin in the environment, so none is recorded.
    await execute(a, a.promote, {
      silent: true,
      stateStore: store,
      readEnv: () => undefined,
    });
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.buildId, undefined);

    const result = await resumeRun(makeBuild(), {
      runId,
      signal: "approved",
      silent: true,
      stateStore: store,
      readEnv: (name) => name === "ZUKE_BUILD_ID" ? "acme/api" : undefined,
    });
    assertEquals(result.ok, true);
    assertEquals(promoted, 1);
  });
});

Deno.test("a sweep does not count a run another process already finished", async () => {
  // Two sweeps racing one run is the normal case. The loser lists the run as
  // suspended, and by the time it resumes, the winner has finished it — so it
  // reads a terminal status. That is a discovered success, not a fault, and
  // counting it would put a false alarm in the exit code a cron watches.
  await withTempStore(async (store) => {
    class B extends Build {
      go = target().executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    await execute(b, b.go, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.status, "succeeded");

    const lines: string[] = [];
    const outcome = await resumeCheck(b, {
      runId,
      stateStore: store,
      silent: true,
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    assertEquals(outcome.failed, 0);
    // Skipped, but said out loud — a sweep that swallowed it would be
    // indistinguishable from one that advanced the run.
    assertEquals(
      lines.some((l) => l.includes("no longer")),
      true,
    );
  });
});

Deno.test("the typed error carries the status it found instead", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      go = target().executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    await execute(b, b.go, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // Naming one run by hand still reports it: the caller asked about that run.
    const error = await assertRejects(
      () => resumeRun(b, { runId, stateStore: store, silent: true }),
      RunNotSuspendedError,
      "not suspended",
    );
    assertEquals(error instanceof RunNotSuspendedError, true);
    if (!(error instanceof RunNotSuspendedError)) return;
    assertEquals(error.runId, runId);
    assertEquals(error.status, "succeeded");
  });
});

Deno.test("resumeRun and resumeCheck refuse to start with state disabled", async () => {
  // A resume without a store has nothing to resume from; the refusal names
  // every way to configure one.
  class B extends Build {
    go = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await assertRejects(
    () => resumeRun(b, { runId: "x", stateStore: false, silent: true }),
    Error,
    "no state store is configured",
  );
  await assertRejects(
    () => resumeCheck(b, { stateStore: false, silent: true }),
    Error,
    "resume --check: no state store",
  );
});

Deno.test("resumeRun names a target the build lost since the run suspended", async () => {
  // The drift check's third shape: not an added or re-wired target, but one
  // the record has and the build no longer declares. The refusal has to name
  // it, or the operator cannot decide whether --force-graph is safe.
  await withTempStore(async (store) => {
    class Suspends extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new Suspends();
    discoverTargets(a);
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // The record remembers a target this build has since deleted.
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("expected the suspended run");
    const amended = structuredClone(loaded.record);
    amended.graph.push({ name: "legacy", dependsOn: [] });
    assertEquals((await store.putRun(amended, loaded.version)).ok, true);

    const resumer = new Suspends();
    discoverTargets(resumer);
    const error = await assertRejects(
      () =>
        resumeRun(resumer, {
          runId,
          signal: "go",
          stateStore: store,
          silent: true,
        }),
      Error,
      "graph changed",
    );
    assertEquals(messageOf(error).includes('removed "legacy"'), true);
    // The refusal leaves the run suspended, so --force-graph can still resume it.
    assertEquals((await store.getRun(runId))?.record.status, "suspended");
  });
});

/** A store where the run vanishes the moment the resume's CAS conflicts. */
class VanishesOnResume extends FileSystemStateStore {
  #conflicted = false;
  /** Conflict the first `running` write; the run is gone after that. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "running" && !this.#conflicted) {
      this.#conflicted = true;
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
  /** Pruned mid-resume: nothing to read back. */
  override getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    if (this.#conflicted) return Promise.resolve(null);
    return super.getRun(id);
  }
}

Deno.test("a run that vanishes mid-resume is reported by name", async () => {
  await withTemp(async (dir) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(externalSignal("go")));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    // Suspend through a well-behaved store; only the resume sees the failure.
    const seedStore = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: seedStore });
    const runId = (await seedStore.listRuns({}))[0].id;

    const store = new VanishesOnResume(`${dir}/runs`, defaultStateHost);
    await assertRejects(
      () =>
        resumeRun(makeBuild(), {
          runId,
          signal: "go",
          stateStore: store,
          silent: true,
        }),
      Error,
      "vanished mid-resume",
    );
  });
});

/** A store that never accepts the `running` transition. */
class RefusesRunning extends FileSystemStateStore {
  /** Conflict every `running` write. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "running") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("resumeRun surfaces a store that never accepts the transition", async () => {
  // Bounded retries: a store outage produces a named error, not an infinite
  // CAS loop — and the run stays suspended, so a later resume can retry.
  await withTemp(async (dir) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(externalSignal("go")));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const seedStore = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: seedStore });
    const runId = (await seedStore.listRuns({}))[0].id;

    const store = new RefusesRunning(`${dir}/runs`, defaultStateHost);
    await assertRejects(
      () =>
        resumeRun(makeBuild(), {
          runId,
          signal: "go",
          stateStore: store,
          silent: true,
        }),
      Error,
      "gave up resuming",
    );
    assertEquals((await seedStore.getRun(runId))?.record.status, "suspended");
  });
});

Deno.test("a throwing plugin does not break a timed-out resume", async () => {
  // The timeout fast-path settles the run without execute()'s lifecycle, so
  // it announces the terminal record to plugins itself — and a plugin is an
  // observer whose throw must never change the outcome.
  await withTempStore(async (store) => {
    class B extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("never")).timeout(0));
      done = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new B();
    discoverTargets(a);
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    const seen: string[] = [];
    const resumer = new B();
    discoverTargets(resumer);
    const result = await resumeRun(resumer, {
      runId,
      stateStore: store,
      silent: true,
      plugins: [{
        onRunStateChange: (record) => {
          seen.push(record.status);
          throw new Error("observer boom");
        },
      }],
    });
    // The timeout still failed the run; the observer's throw was swallowed.
    assertEquals(result.ok, false);
    assertEquals(messageOf(result.error).includes("timed out"), true);
    assertEquals(seen, ["failed"]); // it did see the terminal transition
    assertEquals((await store.getRun(runId))?.record.status, "failed");
  });
});

/** A store where the timeout settlement's first write loses a race. */
class ConflictsOnceOnFail extends FileSystemStateStore {
  /** Whether the manufactured conflict has fired. */
  conflicted = false;
  /** Conflict the first `failed` write, then behave. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "failed" && !this.conflicted) {
      this.conflicted = true;
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("a timeout settlement retries a conflicting write", async () => {
  // Another writer (an audit append, a lock heartbeat) can land between the
  // read and the settle. The settlement re-reads and retries rather than
  // leaving the expired run suspended forever.
  await withTemp(async (dir) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) =>
          s.on(externalSignal("never")).timeout(0)
        );
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const seedStore = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: seedStore });
    const runId = (await seedStore.listRuns({}))[0].id;

    const store = new ConflictsOnceOnFail(`${dir}/runs`, defaultStateHost);
    const result = await resumeRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, false);
    assertEquals(store.conflicted, true); // the race really happened
    // The retry landed: the run is failed, not stranded suspended.
    assertEquals((await store.getRun(runId))?.record.status, "failed");
    assertEquals(
      (await store.getRun(runId))?.record.targets.gate.status,
      "failed",
    );
  });
});

Deno.test("time parked at a gate is credited back to the run's deadline", async () => {
  // A deadline is a budget for *running*: a 45-minute budget behind a 72-hour
  // approval gate would otherwise be spent before anyone could approve, and
  // the run settled the instant it woke up.
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(externalSignal("go")));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // The run has an hour of budget left, and has been parked for an hour:
    // `updatedAt` is when it suspended.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("expected the suspended run");
    const amended = structuredClone(loaded.record);
    amended.updatedAt = hourAgo;
    amended.deadlineAt = inAnHour;
    assertEquals((await store.putRun(amended, loaded.version)).ok, true);

    const result = await resumeRun(makeBuild(), {
      runId,
      signal: "go",
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, true);
    const after = await store.getRun(runId);
    const credited = Date.parse(after?.record.deadlineAt ?? "") -
      Date.parse(inAnHour);
    // The parked hour was given back (within scheduling slack).
    assertEquals(credited >= 60 * 60 * 1000 - 1000, true);
    assertEquals(credited < 2 * 60 * 60 * 1000, true);
  });
});

/** A store where the run vanishes the moment the timeout settlement conflicts. */
class VanishesOnFail extends FileSystemStateStore {
  #conflicted = false;
  /** Conflict the first `failed` write; the run is gone after that. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "failed" && !this.#conflicted) {
      this.#conflicted = true;
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
  /** Pruned mid-settlement: nothing to read back. */
  override getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    if (this.#conflicted) return Promise.resolve(null);
    return super.getRun(id);
  }
}

Deno.test("a run that vanishes during the timeout settlement still fails cleanly", async () => {
  // The settlement CAS conflicts and the re-read finds nothing: the record was
  // pruned. There is nothing left to settle, but the caller still gets the
  // timeout failure rather than a crash or a false success.
  await withTemp(async (dir) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) =>
          s.on(externalSignal("never")).timeout(0)
        );
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const seedStore = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: seedStore });
    const runId = (await seedStore.listRuns({}))[0].id;

    const store = new VanishesOnFail(`${dir}/runs`, defaultStateHost);
    const result = await resumeRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, false);
    assertEquals(messageOf(result.error).includes("timed out"), true);
  });
});

Deno.test("resume --check counts a run that resumed and then failed", async () => {
  // The sweep's exit code is what a cron watches: a run it advanced into a
  // failure (here, a timed-out wait) must count, not just runs it could not
  // touch at all.
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) =>
          s.on(externalSignal("never")).timeout(0)
        );
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: store });

    const swept = await resumeCheck(makeBuild(), {
      stateStore: store,
      silent: true,
    });
    assertEquals(swept, { checked: 1, failed: 1 });
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.status, "failed");
  });
});

Deno.test("a sweep skips a run another process holds, without counting it", async () => {
  // A live resumer holds the run's lease. The sweep's own resume attempt gets
  // AlreadyResumedError from the other side of that race — which is a run in
  // good hands, not a failure for the cron to alarm on.
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        gate = target().waitsFor((s) => s.on(externalSignal("go")));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    // Another process's claim on the run.
    const held = await store.acquireLock(
      lockKey(RUN_LEASE_PREFIX, runId),
      { actor: "the-resumer", runId, since: new Date().toISOString() },
      60_000,
    );
    assertEquals(held.ok, true);

    const swept = await resumeCheck(makeBuild(), {
      stateStore: store,
      silent: true,
    });
    assertEquals(swept, { checked: 1, failed: 0 });
    // Left exactly as found — the holder is driving it.
    assertEquals((await store.getRun(runId))?.record.status, "suspended");
  });
});
