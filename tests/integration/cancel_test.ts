// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the cancellation flow driven through the real CLI. A build
 * suspends at a `waitsFor()` gate; a later `zuke cancel <run-id>` command (a
 * fresh `main()` call — a distinct "process") stops it, runs the compensations
 * of every target that had succeeded, and settles the record as `cancelled`.
 * The run id and status are read back from a {@link FileSystemStateStore} over
 * the same temp `ZUKE_STATE_DIR` the harness set.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  type RunRecord,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The id of the (single non-audit) run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** The full persisted record of run `id` under `dir`. */
async function loadRun(dir: string, id: string): Promise<RunRecord> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  if (got === null) throw new Error(`run ${id} not found`);
  return got.record;
}

Deno.test("zuke cancel stops a suspended run and runs its compensations", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class CD extends Build {
      deploy = target()
        .executes((ctx) => {
          log.push("deploy");
          return ctx.state.set({ slot: "sit-7" });
        })
        .onCancel(() => this.rollback);
      rollback = target().executes((ctx) =>
        void log.push(`rollback:${ctx.state.get().slot}`)
      );
      gate = target()
        .dependsOn(this.deploy)
        .waitsFor((s) => s.on(externalSignal("approved")));
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
    }

    // First process: deploy runs, then the run suspends at the gate (exit 0).
    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["deploy"]);
    const id = await onlyRunId(dir);
    assertEquals((await loadRun(dir, id)).status, "suspended");

    // Second process: cancel it. The compensation runs, reading deploy's slot.
    const cancelled = await runCli(CD, ["cancel", id, "--actor", "ops"]);
    assertEquals(cancelled.code, 0);
    assertEquals(log, ["deploy", "rollback:sit-7"]);
    assertStringIncludes(cancelled.out, "cancelled");

    // The record is cancelled, with the cancellation in its audit trail.
    const record = await loadRun(dir, id);
    assertEquals(record.status, "cancelled");
    assertEquals(record.events.some((e) => e.tool === "cancel"), true);

    // `runs show` reconstructs the cancelled status and the audit line.
    const show = await runCli(CD, ["runs", "show", id]);
    assertEquals(show.code, 0);
    assertStringIncludes(show.out, "status:   cancelled");
    assertStringIncludes(show.out, "cancel");

    // A second cancel is a friendly no-op; the compensation does not run again.
    const again = await runCli(CD, ["cancel", id]);
    assertEquals(again.code, 0);
    assertStringIncludes(again.out, "already cancelled");
    assertEquals(log, ["deploy", "rollback:sit-7"]);
  });
});

Deno.test("zuke cancel runs each fan-out item's own onCancel compensation", async () => {
  await withStateDir(async (dir) => {
    const undone: string[] = [];
    class CD extends Build {
      deployBatch = target().forEach(
        () => ["repo-a", "repo-b"],
        (repo) => ({
          deploy: target()
            .executes((ctx) => ctx.state.set({ slot: `slot-${repo}` }))
            .onCancel(() =>
              target().executes((ctx) =>
                void undone.push(`${repo}:${ctx.state.get().slot}`)
              )
            ),
        }),
        (s) => s.continueOnItemFailure(),
      );
      gate = target()
        .dependsOn(this.deployBatch)
        .waitsFor((s) => s.on(externalSignal("approved")));
    }

    // First process: the batch deploys, then the run suspends at the gate.
    const first = await runCli(CD, ["gate"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);
    assertEquals((await loadRun(dir, id)).status, "suspended");

    // Second process: cancel it. Each item's own compensation runs, reading that
    // item's persisted slot — reverse order.
    const cancelled = await runCli(CD, ["cancel", id]);
    assertEquals(cancelled.code, 0);
    assertEquals(undone, ["repo-b:slot-repo-b", "repo-a:slot-repo-a"]);

    // Each item's compensation is its own audit entry naming the runtime target.
    const record = await loadRun(dir, id);
    const compensated = record.events
      .filter((e) => e.tool === "compensate")
      .map((e) => e.args.target)
      .sort();
    assertEquals(compensated, [
      "deployBatch[repo-a].deploy",
      "deployBatch[repo-b].deploy",
    ]);
  });
});

Deno.test("zuke cancel compensates a declared target reused as a fan-out stage", async () => {
  await withStateDir(async (dir) => {
    const undone: string[] = [];
    class CD extends Build {
      // A build may reuse a declared target as the fan-out's stage. Cancel
      // re-materialises the fan-out, and doing that must not rename `seed` —
      // the walk reaches it afterwards and finds its record row by name.
      seed = target()
        .executes(() => {})
        .onCancel(() => target().executes(() => void undone.push("seed")));
      deployBatch = target()
        .dependsOn(this.seed)
        .forEach(() => ["repo-a"], () => ({ seed: this.seed }));
      gate = target()
        .dependsOn(this.deployBatch)
        .waitsFor((s) => s.on(externalSignal("approved")));
    }

    const first = await runCli(CD, ["gate"]);
    assertEquals(first.code, 0, first.err);
    const id = await onlyRunId(dir);
    assertEquals((await loadRun(dir, id)).status, "suspended");

    const cancelled = await runCli(CD, ["cancel", id]);
    assertEquals(cancelled.code, 0, cancelled.err);
    // Both the fan-out item and the declared target are undone, each recorded
    // under its own name — not the item's name twice.
    assertEquals(undone, ["seed", "seed"]);
    const record = await loadRun(dir, id);
    const compensated = record.events
      .filter((e) => e.tool === "compensate")
      .map((e) => e.args.target)
      .sort();
    assertEquals(compensated, ["deployBatch[repo-a].seed", "seed"]);
  });
});

Deno.test("zuke cancel of a finished run is a no-op", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class B extends Build {
      work = target().executes(() => void log.push("work"))
        .onCancel(() => this.undo);
      undo = target().executes(() => void log.push("undo"));
    }
    // A plain run with a durable feature (onCancel) persists to .zuke/runs.
    const ran = await runCli(B, ["work"]);
    assertEquals(ran.code, 0);
    const id = await onlyRunId(dir);
    assertEquals((await loadRun(dir, id)).status, "succeeded");

    const cancelled = await runCli(B, ["cancel", id]);
    assertEquals(cancelled.code, 0);
    assertStringIncludes(cancelled.out, "already succeeded");
    assertEquals(log, ["work"]); // undo never ran
  });
});

Deno.test("zuke cancel with a missing run id fails with usage", async () => {
  await withStateDir(async () => {
    class B extends Build {
      go = target().executes(() => {});
    }
    const bad = await runCli(B, ["cancel"]);
    assertEquals(bad.code, 1);
    assertStringIncludes(bad.err, "Usage: zuke cancel");
  });
});

Deno.test("a compensation's context reads its target's meta, and nothing else's", async () => {
  // Pins the contract documented in docs/orchestration.md. The trap it exists
  // to stop: `ctx.state` holds the COMPENSATED target's meta while `ctx.target`
  // names the compensation, and asking for that same target through `stateOf`
  // reads empty — so a rollback written the obvious way silently does nothing.
  await withStateDir(async () => {
    const seen: string[] = [];
    const controller = new AbortController();
    class CD extends Build {
      rollback = target().executes(async (ctx) => {
        seen.push(`target=${ctx.target}`);
        // The compensated target's meta, reached through `state`...
        seen.push(`state=${JSON.stringify(ctx.state.get())}`);
        // ...and not through its name.
        seen.push(
          `stateOf(deploy)=${JSON.stringify(ctx.stateOf("deploy").get())}`,
        );
        seen.push(
          `stateOf(other)=${JSON.stringify(ctx.stateOf("other").get())}`,
        );
        // The documented self-identity still holds for the compensation itself.
        seen.push(`selfIdentity=${ctx.stateOf(ctx.target) === ctx.state}`);
        // Outcomes come from the durable record, so these do work.
        seen.push(`outcomeOf(deploy)=${ctx.outcomeOf("deploy")?.status}`);
        // `rollback` is not a node in THIS graph, so it is not in the plan.
        // That is a fact about this fixture, not about compensations — the
        // test below covers a compensation that is also a graph target.
        seen.push(`inPlan=${ctx.plan().includes("rollback")}`);
        // Writes merge into the seeded meta, in memory only.
        await ctx.state.set({ undone: "yes" });
        seen.push(`afterSet=${JSON.stringify(ctx.state.get())}`);
      });
      other = target().executes((ctx) => ctx.state.set({ from: "other" }));
      deploy = target()
        .dependsOn(this.other)
        .executes(async (ctx) => {
          await ctx.state.set({ slot: "sit-7" });
          controller.abort();
        })
        .onCancel(() => this.rollback);
      promote = target().dependsOn(this.deploy).executes(() => {});
    }
    const { code } = await runCli(CD, ["promote"], {
      signal: controller.signal,
    });
    assertEquals(code, 1);
    assertEquals(seen, [
      "target=rollback",
      'state={"slot":"sit-7"}',
      "stateOf(deploy)={}",
      "stateOf(other)={}",
      "selfIdentity=true",
      "outcomeOf(deploy)=succeeded",
      "inPlan=false",
      'afterSet={"slot":"sit-7","undone":"yes"}',
    ]);
  });
});

Deno.test("a compensation that is also a graph target is in the run's plan", async () => {
  // The companion to the test above, whose fixture declares its compensation
  // off the graph. `ctx.plan()` is the whole run's plan and nothing filters a
  // compensation out of it, so "a compensation is not in the plan" would be a
  // property of that fixture rather than of compensations.
  await withStateDir(async () => {
    const seen: string[] = [];
    const controller = new AbortController();
    class CD extends Build {
      rollback = target().executes((ctx) => {
        seen.push(`${ctx.target} inPlan=${ctx.plan().includes("rollback")}`);
      });
      deploy = target()
        .dependsOn(this.rollback)
        .executes(async (ctx) => {
          await ctx.state.set({ slot: "sit-7" });
          controller.abort();
        })
        .onCancel(() => this.rollback);
      promote = target().dependsOn(this.deploy).executes(() => {});
    }
    await runCli(CD, ["promote"], { signal: controller.signal });
    // Once running forward as an ordinary target, once as the compensation —
    // in the plan both times.
    assertEquals(seen, [
      "rollback inPlan=true",
      "rollback inPlan=true",
    ]);
  });
});

Deno.test("a timed-out wait's compensation target compensates itself", async () => {
  // The other way a compensation is reached. `.onTimeout(() => this.cleanup)`
  // builds the step FOR `cleanup`, so `ctx.state` is cleanup's own meta — not
  // the deployed target's. A rollback written for the `.onCancel` shape, going
  // after deploy's slot, finds nothing here.
  await withStateDir(async () => {
    const seen: string[] = [];
    class B extends Build {
      cleanup = target().executes((ctx) => {
        seen.push(`target=${ctx.target}`);
        // Its OWN meta, empty because it never ran forward...
        seen.push(`state=${JSON.stringify(ctx.state.get())}`);
        // ...and emphatically not the deployed target's.
        seen.push(
          `stateOf(deploy)=${JSON.stringify(ctx.stateOf("deploy").get())}`,
        );
        // The one invariant that holds on both compensation paths.
        seen.push(`selfIdentity=${ctx.stateOf(ctx.target) === ctx.state}`);
      });
      deploy = target().executes((ctx) => ctx.state.set({ slot: "sit-7" }));
      gate = target()
        .dependsOn(this.deploy)
        .waitsFor((s) =>
          s.on(externalSignal("approved")).timeout(0).onTimeout(() =>
            this.cleanup
          )
        );
      promote = target().dependsOn(this.gate).executes(() => {});
    }
    assertEquals((await runCli(B, ["promote"])).code, 0);
    // The sweep finds the missed deadline and runs the named target.
    assertEquals((await runCli(B, ["resume", "--check"])).code, 1);
    assertEquals(seen, [
      "target=cleanup",
      "state={}",
      "stateOf(deploy)={}",
      "selfIdentity=true",
    ]);
  });
});
