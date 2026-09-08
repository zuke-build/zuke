// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the invariant that a terminal run carries no live waiter,
 * across the paths the writer owns: the in-process cancellation's sweep, and
 * the guard that stops a process parking a gate onto a run somebody else has
 * already settled.
 *
 * The out-of-process half — `zuke cancel` reaching `finalizeCancelled` — is
 * covered in `cancel_test.ts` and `tests/integration/waiting_test.ts`.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { execute } from "../src/executor.ts";
import { target } from "../src/target.ts";
import { externalSignal } from "../src/wait.ts";
import { Redactor } from "../src/redact.ts";
import { RunStateWriter } from "../src/state/writer.ts";
import { runRecord } from "./_fakes.ts";
import { withTempStore } from "./_store.ts";

Deno.test("an in-process cancellation settles the gate it was parked on", async () => {
  await withTempStore(async (store) => {
    const ctrl = new AbortController();
    class B extends Build {
      gate = target().waitsFor((s) =>
        s.on(externalSignal("never")).timeout("1h")
      );
      // Runs beside the gate and aborts once the gate is parked, which is the
      // only way to reach the in-process cancellation with a live waiter: a
      // serialised run never launches the gate at all.
      other = target().executes(async () => {
        await new Promise((r) => setTimeout(r, 50));
        ctrl.abort();
      });
      root = target().dependsOn(this.gate, this.other).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    await execute(b, b.root, {
      silent: true,
      stateStore: store,
      signal: ctrl.signal,
      parallel: true,
    });

    const runId = (await store.listRuns({}))[0].id;
    const record = (await store.getRun(runId))?.record;
    assertEquals(record?.status, "cancelled");
    // The executor's own cancel path settles the run through the writer, not
    // through `finalizeCancelled`, so it needs the same sweep: otherwise the
    // gate stays `waiting` on a terminal record and `runs show` prints it as
    // parked on a deadline nobody is watching.
    assertEquals(record?.targets.gate.status, "skipped");
    assertEquals(record?.targets.gate.waitingFor, undefined);
  });
});

Deno.test("a gate is not parked onto a run someone else already settled", async () => {
  await withTempStore(async (store) => {
    const initial = runRecord({
      id: "r1",
      rootTarget: "gate",
      status: "running",
      targets: { gate: { status: "pending", meta: {} } },
    });
    const created = await store.putRun(initial, null);
    assertEquals(created.ok, true);
    if (!created.ok) return;

    const writer = RunStateWriter.adopt(
      store,
      structuredClone(initial),
      created.version,
      () => "2026-09-08T10:30:00.000Z",
      new Redactor(),
    );

    // Another process cancels the run and sweeps it, winning the CAS.
    const settled = structuredClone(initial);
    settled.status = "cancelled";
    settled.targets.gate = {
      status: "skipped",
      meta: {},
      endedAt: "2026-09-08T10:00:00.000Z",
    };
    const done = await store.putRun(settled, created.version);
    assertEquals(done.ok, true);

    // This process parks its gate a moment later. Its write conflicts, and the
    // writer re-applies target-level mutations onto the fresh record so a
    // just-settled `succeeded` is not lost — but parking a gate is not such a
    // mutation. Re-applying it would put `waiting` back on a terminal record,
    // beside the `endedAt` the sweep wrote.
    await writer.markTargetWaiting("gate", {
      trigger: "signal:approved",
      onTimeout: "fail",
      deadline: "2026-09-08T11:00:00.000Z",
    });

    const after = (await store.getRun("r1"))?.record;
    assertEquals(after?.status, "cancelled");
    assertEquals(after?.targets.gate.status, "skipped");
    assertEquals(after?.targets.gate.waitingFor, undefined);
  });
});
