// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the scheduler's effect driving and outcome visibility — the
 * guard that refuses an effect with nowhere to record its intent, the skip that
 * makes re-driving a completed effect free, the rule that a bookkeeping failure
 * never masks the effect's own error, what a resumed body can read of an
 * earlier process's outcomes, and how a run that both parked and failed settles
 * every row terminally (F8).
 *
 * @module
 */

import { assertEquals, messageOf } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target, type TargetOutcomeView } from "../src/target.ts";
import { type RunContext, runSequential } from "../src/scheduler.ts";
import { makeLifecycle } from "../src/lifecycle.ts";
import { defaultRenderer } from "../src/renderer.ts";
import { ServiceRegistry } from "../src/service.ts";
import { Redactor } from "../src/redact.ts";
import { RunStateWriter } from "../src/state/writer.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost, type PutResult } from "../src/state/store.ts";
import type { RunEnv } from "../src/run_support.ts";
import type { RunRecord } from "../src/state/types.ts";
import { execute } from "../src/executor.ts";
import { resumeRun } from "../src/resume.ts";
import { externalSignal } from "../src/wait.ts";

const NOW = "2026-08-10T12:00:00.000Z";

/** A {@link RunContext} over `build`, capturing every reported line. */
function contextFor(
  build: Build,
  writer?: RunStateWriter,
): { ctx: RunContext; lines: string[] } {
  const lines: string[] = [];
  const env: RunEnv = {
    runId: "run-1",
    signal: new AbortController().signal,
    actor: "tester",
    signals: new Map(),
    statuses: new Map(),
    ...(writer === undefined ? {} : { writer }),
  };
  return {
    ctx: {
      life: makeLifecycle(
        build,
        [],
        { runId: "run-1", dryRun: false },
        () => {},
      ),
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
      renderer: defaultRenderer,
      style: { github: false, color: false, width: 60 },
      cache: undefined,
      dryRun: false,
      globalRecovery: [],
      services: new ServiceRegistry(),
      env,
    },
    lines,
  };
}

/** A `running` record rooted at `root` with the given target rows. */
function runningRecord(
  root: string,
  build: string,
  targets: RunRecord["targets"],
): RunRecord {
  return {
    id: "run-1",
    build,
    rootTarget: root,
    status: "running",
    actor: "tester",
    createdAt: NOW,
    updatedAt: NOW,
    graph: [{ name: root, dependsOn: [] }],
    params: {},
    targets,
    signals: {},
    events: [],
  };
}

/** Run `fn` with a temp filesystem store, cleaned up afterwards. */
async function withTempStore(
  fn: (store: FileSystemStateStore, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost), dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** A store whose next put can be made to fail, for the settle-write path. */
class FailsPut extends FileSystemStateStore {
  /** Reject the next `putRun` with a store error. */
  failNextPut = false;
  /** Persist normally unless armed to fail. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (this.failNextPut) {
      this.failNextPut = false;
      return Promise.reject(new Error("store down"));
    }
    return super.putRun(record, expected);
  }
}

Deno.test("an effect with no state store fails the target before its body runs", async () => {
  // The fail-closed half of durable effects: with nowhere to record the
  // intent, running the body would perform a side effect nothing knows was
  // owed. execute() refuses such a run up front; this is the scheduler's own
  // backstop for a context assembled without a writer.
  let ran = false;
  class B extends Build {
    notify = target().effect("announce", () => {
      ran = true;
    });
  }
  const b = new B();
  discoverTargets(b);
  const { ctx } = contextFor(b);

  const run = await runSequential(ctx, [b.notify], new Set());
  assertEquals(run.aborted, true);
  assertEquals(ran, false); // no durable intent, no side effect
  assertEquals(
    messageOf(run.failure).includes(
      "needs a state store to record its intent",
    ),
    true,
  );
});

Deno.test("a re-driven target skips an effect already recorded done", async () => {
  // The no-op that makes re-driving free: a process died after the effect
  // settled `done` but before the target did, so a resume runs the target
  // again — and must not repeat the effect (it is at-least-once, not twice).
  await withTempStore(async (store) => {
    let ran = 0;
    class B extends Build {
      notify = target().effect("announce", () => {
        ran += 1;
      });
    }
    const b = new B();
    discoverTargets(b);
    const writer = await RunStateWriter.open(
      store,
      runningRecord("notify", "B", {
        notify: {
          status: "pending",
          meta: {},
          effects: {
            announce: {
              status: "done",
              intentAt: NOW,
              settledAt: NOW,
              attempts: 1,
            },
          },
        },
      }),
      () => NOW,
      new Redactor(),
    );
    const { ctx } = contextFor(b, writer);

    const run = await runSequential(ctx, [b.notify], new Set());
    await writer.drain();
    assertEquals(run.aborted, false);
    assertEquals(ran, 0); // the completed effect was not repeated
    const after = await store.getRun("run-1");
    assertEquals(after?.record.targets.notify?.status, "succeeded");
    // The row is untouched: still one attempt, still done.
    assertEquals(after?.record.targets.notify?.effects?.announce?.attempts, 1);
    assertEquals(
      after?.record.targets.notify?.effects?.announce?.status,
      "done",
    );
  });
});

Deno.test("a failed settle write never masks the effect's own failure", async () => {
  // The incident-report rule: when recording an effect's failure fails too,
  // the caller must still see the API error that actually happened — the
  // bookkeeping failure is reported alongside, never in its place.
  const dir = await Deno.makeTempDir();
  try {
    const store = new FailsPut(`${dir}/runs`, defaultStateHost);
    class B extends Build {
      deploy = target().effect("announce", () => {
        store.failNextPut = true; // the settle write that follows will fail
        throw new Error("deploy API boom");
      });
    }
    const b = new B();
    discoverTargets(b);
    const writer = await RunStateWriter.open(
      store,
      runningRecord("deploy", "B", {
        deploy: { status: "pending", meta: {} },
      }),
      () => NOW,
      new Redactor(),
    );
    const { ctx, lines } = contextFor(b, writer);

    const run = await runSequential(ctx, [b.deploy], new Set());
    await writer.drain();
    assertEquals(run.aborted, true);
    // The original failure is the run's failure…
    assertEquals(messageOf(run.failure), "deploy API boom");
    // …and the lost bookkeeping is narrated, naming both errors.
    assertEquals(
      lines.some((l) =>
        l.includes("recording that failed too") && l.includes("store down")
      ),
      true,
    );
    // The settle write really was lost: the intent is still armed, so a later
    // resume re-drives the effect rather than trusting a phantom settlement.
    const after = await store.getRun("run-1");
    assertEquals(
      after?.record.targets.deploy?.effects?.announce?.status,
      "pending",
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("a resumed body reads outcomes another process settled", async () => {
  // A resume is a fresh process: its in-memory settlement map starts empty, so
  // `ctx.outcomeOf`/`ctx.outcomes` must fall back to the durable record for
  // targets an earlier process ran — and still omit rows with no outcome yet.
  await withTempStore(async (store) => {
    let fromRecord: TargetOutcomeView | undefined;
    let missing: TargetOutcomeView | undefined;
    let all: ReadonlyMap<string, TargetOutcomeView> | undefined;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(() => {});
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("go")));
        verify = target().dependsOn(this.gate).executes(async (ctx) => {
          // Write state for a target that has not run yet, so the record holds
          // a `pending` row — which must not appear as an outcome.
          await ctx.stateOf("finish").set({ planned: true });
          fromRecord = ctx.outcomeOf("deploy");
          missing = ctx.outcomeOf("ghost");
          all = ctx.outcomes();
        });
        finish = target().dependsOn(this.verify).executes(() => {});
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    const first = await execute(a, a.finish, {
      silent: true,
      stateStore: store,
    });
    assertEquals(first.suspended, true);
    const runId = (await store.listRuns({}))[0].id;

    const resumed = await resumeRun(makeBuild(), {
      runId,
      signal: "go",
      stateStore: store,
      silent: true,
    });
    assertEquals(resumed.ok, true);
    // deploy settled in the *previous* process — visible only via the record.
    assertEquals(fromRecord?.status, "succeeded");
    // A target with no row at all has no outcome.
    assertEquals(missing, undefined);
    // The aggregate view merges the record (deploy) with this process (gate)…
    assertEquals(all?.get("deploy")?.status, "succeeded");
    assertEquals(all?.get("gate")?.status, "succeeded");
    // …and omits the pending row: a target that has not run has no outcome.
    assertEquals(all?.has("finish"), false);
  });
});

Deno.test("a satisfied gate whose effect fails fails the target, not silently", async () => {
  // A `.waitsFor(...)` gate that opens is the target's real run, so its
  // effects are owed at that moment — and an effect that throws must fail the
  // gate rather than letting the run report success over a dropped effect.
  await withTempStore(async (store) => {
    let effectTried = 0;
    const makeBuild = () => {
      class B extends Build {
        gate = target()
          .waitsFor((s) => s.on(externalSignal("go")))
          .effect("announce", () => {
            effectTried += 1;
            throw new Error("announce boom");
          });
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    const first = await execute(a, a.done, { silent: true, stateStore: store });
    assertEquals(first.suspended, true);
    assertEquals(effectTried, 0); // a parked gate owes nothing yet
    const runId = (await store.listRuns({}))[0].id;

    const resumed = await resumeRun(makeBuild(), {
      runId,
      signal: "go",
      stateStore: store,
      silent: true,
    });
    assertEquals(resumed.ok, false);
    assertEquals(messageOf(resumed.error).includes("announce boom"), true);
    assertEquals(effectTried, 1);
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "failed");
    assertEquals(loaded?.record.targets.gate?.status, "failed");
    // The failed effect is recorded, so a later attempt re-arms it.
    assertEquals(
      loaded?.record.targets.gate?.effects?.announce?.status,
      "failed",
    );
  });
});

Deno.test("teardown stranded behind a parked gate settles skipped when the run fails", async () => {
  // A run that both parked a wait and failed will never resume, so nothing
  // behind the gate can ever run — including an `always` teardown waiting for
  // the gate to settle. The gate parked *before* the failure, so it was never
  // abandoned and never settles; the teardown behind it can never become
  // ready, and the final sweep must settle it terminally: a `pending` row
  // inside a terminal `failed` record would sit in `runs show` and the resume
  // sweep forever (F8).
  await withTempStore(async (store) => {
    let toreDown = false;
    class B extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("never")));
      teardown = target().always().dependsOn(this.gate).executes(() => {
        toreDown = true;
      });
      boom = target().executes(() => {
        throw new Error("boom");
      });
      // Declared so the plan runs the gate first: it parks, *then* boom fails.
      all = target()
        .dependsOn(this.boom, this.teardown)
        .executes(() => {});
    }
    const b = new B();
    discoverTargets(b);

    const result = await execute(b, b.all, { silent: true, stateStore: store });
    // Failed, not suspended: a failure outranks the parked gate.
    assertEquals(result.ok, false);
    assertEquals(messageOf(result.error), "boom");

    const runId = (await store.listRuns({}))[0].id;
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "failed");
    // Every row is terminal — the never-launched teardown included.
    assertEquals(toreDown, false); // its gate never opened, so it never ran
    assertEquals(loaded?.record.targets.teardown?.status, "skipped");
    assertEquals(loaded?.record.targets.gate?.status, "skipped");
    assertEquals(loaded?.record.targets.boom?.status, "failed");
  });
});

Deno.test("a re-driven effect settles done and knows it is a second attempt", async () => {
  // The at-least-once half: a previously failed effect is re-armed, its body
  // told it is being re-driven (so it can favour idempotent variants), and a
  // completed attempt is durably `done` for the next process to skip.
  await withTempStore(async (store) => {
    const drives: boolean[] = [];
    let effectName: string | undefined;
    class B extends Build {
      notify = target().effect("announce", (ctx) => {
        drives.push(ctx.redriven);
        effectName = ctx.effect;
      });
    }
    const b = new B();
    discoverTargets(b);
    const writer = await RunStateWriter.open(
      store,
      runningRecord("notify", "B", {
        notify: {
          status: "pending",
          meta: {},
          // A previous process armed the intent and recorded the failure.
          effects: {
            announce: {
              status: "failed",
              intentAt: NOW,
              settledAt: NOW,
              attempts: 1,
              error: "first try boom",
            },
          },
        },
      }),
      () => NOW,
      new Redactor(),
    );
    const { ctx } = contextFor(b, writer);

    const run = await runSequential(ctx, [b.notify], new Set());
    await writer.drain();
    assertEquals(run.aborted, false);
    assertEquals(drives, [true]); // the body knew it was a re-drive
    assertEquals(effectName, "announce");
    const after = await store.getRun("run-1");
    assertEquals(
      after?.record.targets.notify?.effects?.announce?.status,
      "done",
    );
    assertEquals(after?.record.targets.notify?.effects?.announce?.attempts, 2);
    // A settled success clears the recorded failure.
    assertEquals(
      after?.record.targets.notify?.effects?.announce?.error,
      undefined,
    );
  });
});

Deno.test("outcomeOf falls back to a record row this process never settled", async () => {
  // The concurrent-writer shape: the snapshot can hold a settled row this
  // process never ran (a conflicting write re-read adopts the fresh record).
  // `outcomeOf` must answer from the record then — and still say nothing for a
  // row that has no outcome yet.
  await withTempStore(async (store) => {
    let observed: TargetOutcomeView | undefined;
    let all: ReadonlyMap<string, TargetOutcomeView> | undefined;
    class B extends Build {
      report = target().executes((ctx) => {
        observed = ctx.outcomeOf("external");
        all = ctx.outcomes();
      });
    }
    const b = new B();
    discoverTargets(b);
    const writer = await RunStateWriter.open(
      store,
      runningRecord("report", "B", {
        // Settled by another process; this one holds no live entry for it.
        external: { status: "succeeded", meta: {} },
        // No outcome yet — must stay invisible.
        queued: { status: "pending", meta: {} },
      }),
      () => NOW,
      new Redactor(),
    );
    const { ctx } = contextFor(b, writer);

    const run = await runSequential(ctx, [b.report], new Set());
    assertEquals(run.aborted, false);
    assertEquals(observed?.status, "succeeded"); // read from the record
    assertEquals(all?.get("external")?.status, "succeeded");
    assertEquals(all?.has("queued"), false); // pending rows have no outcome
  });
});

Deno.test("a dry-runnable target runs its body in preview; a failure is reported", async () => {
  // `.dryRunnable()` opts a target into executing under --dry-run (with `$` in
  // echo mode) so the operator previews the real commands; a preview body that
  // throws must surface as a failed target, exactly like a real run.
  class B extends Build {
    preview = target().dryRunnable().executes((ctx) => {
      ran.push(`preview:${ctx.dryRun}`);
    });
    boom = target().dryRunnable().executes(() => {
      throw new Error("preview boom");
    });
    plain = target().executes(() => {
      ran.push("plain");
    });
  }
  const ran: string[] = [];
  const b = new B();
  discoverTargets(b);
  const { ctx } = contextFor(b);
  const dry: RunContext = { ...ctx, dryRun: true };

  const run = await runSequential(dry, [b.preview, b.boom, b.plain], new Set());
  // The dry-runnable body really ran, and knew it was a dry run…
  assertEquals(ran, ["preview:true"]);
  // …the throwing preview failed the run, and the plain target's body was
  // never executed (an ordinary target is only reported under --dry-run).
  assertEquals(run.aborted, true);
  assertEquals(messageOf(run.failure), "preview boom");
});
