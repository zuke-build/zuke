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
