// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `zuke cancel` on a run whose record is **degraded** — a state
 * write was permanently lost, so a target that really did deploy is still
 * recorded `running`. The cancellation must roll it back anyway, and say why.
 * Driven through the real CLI `main()` (via {@link runCli}) against a store that
 * conflicts every write settling `deploy`, which is how a settlement is really
 * lost.
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
  target,
} from "../../packages/core/mod.ts";
import type { RunRecord } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/**
 * A real store whose compare-and-swap always conflicts on a write recording
 * `deploy` as succeeded, so the writer exhausts its retries and loses that
 * settlement for good. Every other write persists normally.
 */
class LosesDeploySettlement extends FileSystemStateStore {
  /** Clear before the cancel, so only the original run loses a write. */
  losing = true;
  /** Conflict on the targeted write; otherwise persist for real. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: true }> {
    if (this.losing && record.targets.deploy?.status === "succeeded") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("zuke cancel compensates an unproven target on a degraded record", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    const store = new LosesDeploySettlement(`${dir}/runs`, defaultStateHost);
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

    // The run suspends at the gate; the lost write leaves the record degraded
    // and the succeeded deploy recorded as still running.
    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["deploy"]);
    const runId = (await store.listRuns({}))[0].id;
    const before = await store.getRun(runId);
    assertEquals(before?.record.degraded, true);
    assertEquals(before?.record.targets.deploy.status, "running");
    store.losing = false; // the racing writer is gone by the time we cancel

    // A fresh process cancels it. `running` is not `succeeded`, but on a
    // degraded record the deploy's success cannot be ruled out — so it is rolled
    // back, from the slot its own metadata recorded.
    const cancelled = await runCli(CD, ["cancel", runId, "--actor", "ops"]);
    assertEquals(cancelled.code, 0);
    assertEquals(log, ["deploy", "rollback:sit-7"]);

    // …and the output says plainly that the record, not the status, is why.
    assertStringIncludes(cancelled.out, "record is incomplete");
    assertStringIncludes(cancelled.out, '"deploy" is recorded running');

    const record = (await store.getRun(runId))?.record;
    assertEquals(record?.status, "cancelled");
    assertEquals(
      record?.events.some((e) =>
        e.tool === "compensate" && e.args.target === "deploy"
      ),
      true,
    );
  });
});
