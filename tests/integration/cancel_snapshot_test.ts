/**
 * Integration: `zuke cancel` decides which compensations to run from the record
 * as it stands **after** its transition to `cancelling`, not from the
 * pre-transition snapshot the compare-and-swap handed back. The owning process
 * lands exactly one write in that window — when its own write loses to the
 * cancel it re-applies the just-finished target onto the cancelling record — so a
 * deploy that really happened must still be rolled back, from the metadata that
 * arrived with it. Driven through the real CLI `main()` (via {@link runCli}).
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import type { PutResult, RunRecord } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/**
 * A real store that lands one extra write the instant the run turns
 * `cancelling`: `deploy` settles `succeeded` with the slot it deployed to. That
 * is the write the owning process re-applies when the canceller's CAS beats its
 * own — it lands after the canceller's snapshot was taken.
 */
class SettlesAfterCancelling extends FileSystemStateStore {
  #landed = false;
  /** Persist normally, then land the racing settlement exactly once. */
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    const result = await super.putRun(record, expected);
    if (!result.ok || this.#landed || record.status !== "cancelling") {
      return result;
    }
    this.#landed = true;
    const loaded = await this.getRun(record.id);
    if (loaded !== null) {
      const next = structuredClone(loaded.record);
      next.targets.deploy = { status: "succeeded", meta: { slot: "sit-9" } };
      await super.putRun(next, loaded.version);
    }
    return result;
  }
}

Deno.test("zuke cancel compensates a target settled after the transition", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    const store = new SettlesAfterCancelling(`${dir}/runs`, defaultStateHost);
    class CD extends Build {
      override stateStore() {
        return store;
      }
      deploy = target()
        .executes((ctx) => {
          log.push("deploy");
          return ctx.state.set({ slot: "sit-7" });
        })
        .onCancel(() => this.rollback);
      rollback = target().executes((ctx) =>
        void log.push(`rollback:${ctx.state.get().slot}`)
      );
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on(externalSignal("approve"))
      );
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
    }

    // The run suspends at the gate with deploy succeeded.
    assertEquals((await runCli(CD, ["promote"])).code, 0);
    assertEquals(log, ["deploy"]);
    const runId = (await store.listRuns({}))[0].id;

    // Rewind the stored settlement: this is how the record reads to a canceller
    // whose transition raced the writer — deploy still `running`, no metadata.
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("expected the run to be stored");
    const rewound = structuredClone(loaded.record);
    rewound.targets.deploy = { status: "running", meta: {} };
    assertEquals((await store.putRun(rewound, loaded.version)).ok, true);

    // Cancelling now: the settlement lands with the transition, so the rollback
    // runs — and runs from the slot that arrived with it, not the rewound blank.
    const cancelled = await runCli(CD, ["cancel", runId, "--actor", "ops"]);
    assertEquals(cancelled.code, 0);
    assertEquals(log, ["deploy", "rollback:sit-9"]);
    assertEquals((await store.getRun(runId))?.record.status, "cancelled");
  });
});
