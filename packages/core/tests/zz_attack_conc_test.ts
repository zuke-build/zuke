// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { cancelRun } from "../src/cancel.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost, type PutResult } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import { externalSignal } from "../src/wait.ts";
import { withTemp } from "./_temp.ts";

const makeBuild = () => {
  class B extends Build {
    gate = target().waitsFor((s) =>
      s.on(externalSignal("approved")).timeout("1h")
    );
    promote = target().dependsOn(this.gate).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);
  return build;
};

/**
 * A store where, the first time the cancel tries to write `cancelled`, another
 * process has just satisfied the gate and recorded it `succeeded`.
 */
class GateSucceedsUnderFinalize extends FileSystemStateStore {
  fired = false;
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "cancelled" && !this.fired) {
      this.fired = true;
      const loaded = await super.getRun(record.id);
      if (loaded === null) throw new Error("gone");
      const amended = structuredClone(loaded.record);
      const gate = amended.targets["gate"];
      gate.status = "succeeded";
      gate.endedAt = new Date().toISOString();
      delete gate.waitingFor;
      amended.updatedAt = new Date().toISOString();
      const w = await super.putRun(amended, loaded.version);
      assertEquals(w.ok, true);
      return { ok: false, conflict: true };
    }
    return await super.putRun(record, expected);
  }
}

Deno.test("A: sweep on retry does not clobber a gate another process succeeded", async () => {
  await withTemp(async (dir) => {
    const seed = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    const res = await execute(a, a.promote, { silent: true, stateStore: seed });
    assertEquals(res.suspended, true);
    const runId = (await seed.listRuns({}))[0].id;

    const store = new GateSucceedsUnderFinalize(
      `${dir}/runs`,
      defaultStateHost,
    );
    const out = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(out.status, "cancelled");
    assertEquals(store.fired, true);
    const loaded = await store.getRun(runId);
    console.log(
      "A: run",
      loaded?.record.status,
      "gate",
      JSON.stringify(loaded?.record.targets["gate"]),
    );
    assertEquals(loaded?.record.targets["gate"].status, "succeeded");
  });
});

import { RunStateWriter } from "../src/state/writer.ts";
import { buildRunRecord } from "../src/state/record.ts";
import { Redactor } from "../src/redact.ts";

Deno.test("B: a late markTargetWaiting re-applies onto a CANCELLED record", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const now = () => new Date().toISOString();
    const record = buildRunRecord({
      runId: crypto.randomUUID(),
      build: "B",
      rootTarget: "promote",
      actor: "me",
      actorKind: "human",
      now: now(),
      order: [],
      params: [],
    });
    record.targets["gate"] = { status: "running", meta: {} };
    const writer = await RunStateWriter.open(
      store,
      record,
      now,
      new Redactor(),
      () => {},
    );
    const id = writer.runId;

    // Another process cancels & finalizes the run (with the new sweep).
    const loaded = await store.getRun(id);
    if (loaded === null) throw new Error("gone");
    const cancelled = structuredClone(loaded.record);
    cancelled.status = "cancelled";
    cancelled.updatedAt = now();
    assertEquals((await store.putRun(cancelled, loaded.version)).ok, true);

    // This process's already-in-flight "gate parked" write lands afterwards.
    await writer.markTargetWaiting("gate", {
      trigger: "signal:approved",
      onTimeout: "fail",
      deadline: new Date(Date.now() + 3600_000).toISOString(),
    });
    await writer.drain();

    const after = await store.getRun(id);
    console.log(
      "B: run",
      after?.record.status,
      "gate",
      JSON.stringify(after?.record.targets["gate"]),
    );
  });
});

/** A store where a `zuke cancel` finalizes just before the gate's park lands. */
class CancelLandsBeforePark extends FileSystemStateStore {
  fired = false;
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (!this.fired && record.targets["gate"]?.status === "waiting") {
      this.fired = true;
      const loaded = await super.getRun(record.id);
      if (loaded === null) throw new Error("gone");
      const amended = structuredClone(loaded.record);
      amended.status = "cancelled"; // finalizeCancelled, sweep included
      for (const row of Object.values(amended.targets)) {
        if (row.status === "waiting") {
          row.status = "skipped";
          delete row.waitingFor;
        }
      }
      amended.updatedAt = new Date().toISOString();
      assertEquals((await super.putRun(amended, loaded.version)).ok, true);
    }
    return await super.putRun(record, expected);
  }
}

Deno.test("C: end-to-end — a park landing after a cancel re-parks a cancelled run", async () => {
  await withTemp(async (dir) => {
    const store = new CancelLandsBeforePark(`${dir}/runs`, defaultStateHost);
    const a = makeBuild();
    await execute(a, a.promote, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    const after = await store.getRun(id);
    console.log(
      "C: fired",
      store.fired,
      "run",
      after?.record.status,
      "gate",
      JSON.stringify(after?.record.targets["gate"]),
    );
  });
});

Deno.test("D: Ctrl-C on a run with a parked gate leaves it waiting on a cancelled record", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const ac = new AbortController();
    class B2 extends Build {
      gate = target().waitsFor((s) =>
        s.on(externalSignal("never")).timeout("1h")
      );
      work = target().executes(() => {
        ac.abort(); // Ctrl-C while the gate is parked
      });
      all = target().dependsOn(this.gate, this.work).executes(() => {});
    }
    const b = new B2();
    discoverTargets(b);
    const res = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      signal: ac.signal,
    });
    const id = (await store.listRuns({}))[0].id;
    const after = await store.getRun(id);
    console.log(
      "D: result.cancelled",
      res.cancelled,
      "run",
      after?.record.status,
      "gate",
      JSON.stringify(after?.record.targets["gate"]),
    );
  });
});

Deno.test("D2: cancellation with NO failure and a parked gate", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const ac = new AbortController();
    class B3 extends Build {
      gate = target().waitsFor((s) =>
        s.on(externalSignal("never")).timeout("1h")
      );
      work = target().executes(() => {
        ac.abort();
      });
      all = target().dependsOn(this.gate, this.work).executes(() => {});
    }
    const b = new B3();
    discoverTargets(b);
    const res = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      signal: ac.signal,
    });
    const id = (await store.listRuns({}))[0].id;
    const after = await store.getRun(id);
    console.log(
      "D2 result:",
      JSON.stringify({
        ok: res.ok,
        cancelled: res.cancelled,
        suspended: res.suspended,
      }),
    );
    console.log("D2 run:", after?.record.status);
    console.log("D2 targets:", JSON.stringify(after?.record.targets, null, 1));
  });
});

Deno.test("D3: parallel — gate parks first, then Ctrl-C, no failure", async () => {
  await withTemp(async (dir) => {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const ac = new AbortController();
    class B4 extends Build {
      gate = target().waitsFor((s) =>
        s.on(externalSignal("never")).timeout("1h")
      );
      work = target().executes(async () => {
        await new Promise((r) => setTimeout(r, 40));
        ac.abort();
      });
      all = target().dependsOn(this.gate, this.work).executes(() => {});
    }
    const b = new B4();
    discoverTargets(b);
    const res = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      signal: ac.signal,
      parallel: 4,
    });
    const id = (await store.listRuns({}))[0].id;
    const after = await store.getRun(id);
    console.log(
      "D3 result:",
      JSON.stringify({ ok: res.ok, cancelled: res.cancelled }),
    );
    console.log("D3 run:", after?.record.status);
    console.log("D3 targets:", JSON.stringify(after?.record.targets, null, 1));
  });
});
