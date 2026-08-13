// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the in-process cancellation settlement — specifically the
 * re-check after `markRunCancelling` drains the write chain: if an external
 * `zuke cancel` won the race in that window, this process must stop without
 * walking the compensations (the canceller owns them — F7).
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { settleCancelledRun } from "../src/execute_cancel.ts";
import { makeLifecycle } from "../src/lifecycle.ts";
import { Redactor } from "../src/redact.ts";
import { RunStateWriter } from "../src/state/writer.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import type { Reporter } from "../src/executor.ts";

const NOW = "2026-08-10T12:00:00.000Z";

Deno.test("the settlement stops when the cancel changes hands during the drain", async () => {
  // The window this closes: this process initiated the cancellation, but
  // marking the run `cancelling` drains every pending write, and a conflict in
  // that drain can reveal another process's `zuke cancel` already landed. The
  // re-check must then stop the walk — running it here too would compensate
  // the same work twice.
  const dir = await Deno.makeTempDir();
  try {
    const undone: string[] = [];
    class Cd extends Build {
      rollback = target().unlisted().executes(() => void undone.push("deploy"));
      deploy = target().onCancel(this.rollback).executes(() => {});
    }
    const build = new Cd();
    discoverTargets(build);

    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const record: RunRecord = {
      id: "run-1",
      build: "Cd",
      rootTarget: "deploy",
      status: "running",
      actor: "runner",
      createdAt: NOW,
      updatedAt: NOW,
      graph: [{ name: "deploy", dependsOn: [] }],
      params: {},
      targets: { deploy: { status: "succeeded", meta: {} } },
      signals: {},
      events: [],
    };
    const writer = await RunStateWriter.open(
      store,
      record,
      () => NOW,
      new Redactor(),
    );
    const lines: string[] = [];
    const reporter: Reporter = {
      info: (l) => lines.push(l),
      error: (l) => lines.push(l),
    };

    const settlement = await settleCancelledRun({
      writer,
      life: makeLifecycle(
        build,
        [],
        { runId: "run-1", dryRun: false },
        () => {},
      ),
      order: [build.deploy],
      runId: "run-1",
      actor: "runner",
      signals: new Map(),
      reporter,
      redactor: new Redactor(),
      nowIso: () => NOW,
      // The external cancel is observed the moment the run reads `cancelling` —
      // exactly what the drain's conflict handler latches in the executor.
      isExternallyCancelled: () => writer.snapshot().status === "cancelling",
    });

    // This process does not own the walk: nothing was compensated and the run
    // is left `cancelling` for the canceller to settle.
    assertEquals(settlement, { ownedWalk: false, compensated: 0 });
    assertEquals(undone, []);
    assertEquals((await store.getRun("run-1"))?.record.status, "cancelling");
    assertEquals(
      lines.some((l) => l.includes("cancelled by another process")),
      true,
    );
    // The cancel lock was released on the way out, so the real canceller (or a
    // recovery pass) is not blocked behind a process that already stopped.
    const reacquired = await writer.acquireCancelLock("the-canceller");
    assertEquals(reacquired !== null, true);
    await reacquired?.release();
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
