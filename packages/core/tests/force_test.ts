// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { forceTarget } from "../src/force.ts";
import { buildRunRecord } from "../src/state/record.ts";
import { parseRunRecord, type RunRecord } from "../src/state/types.ts";
import { withTempStore } from "./_store.ts";
import type { FileSystemStateStore } from "../src/state/fs_store.ts";

/** A build with one ordinary target and one the author declared off-limits. */
class CD extends Build {
  deploy = target().executes(() => {});
  applyProduction = target().executes(() => {});
  override unforceable() {
    return [this.applyProduction];
  }
}

/** Seed a run record with both targets pending. */
async function seed(
  store: FileSystemStateStore,
  over: Partial<RunRecord> = {},
): Promise<string> {
  const build = new CD();
  const record: RunRecord = {
    ...buildRunRecord({
      runId: "run-1",
      build: "CD",
      rootTarget: "deploy",
      actor: "engineer-a",
      actorKind: "human",
      now: "2026-09-06T10:00:00.000Z",
      order: [],
      params: [],
    }),
    targets: {
      deploy: { status: "pending", meta: {} },
      applyProduction: { status: "pending", meta: {} },
    },
    ...over,
  };
  await store.putRun(record, null);
  void build;
  return record.id;
}

Deno.test("forcing records the outcome, the actor and the reason", async () => {
  await withTempStore(async (store) => {
    const runId = await seed(store);
    const result = await forceTarget(new CD(), {
      runId,
      target: "deploy",
      outcome: "skipped",
      reason: "upstream is down",
      actor: "operator-b",
      stateStore: store,
      readEnv: () => undefined,
    });
    assertEquals(result.ok, true);
    assertEquals(result.override?.outcome, "skipped");
    assertEquals(result.override?.actor, "operator-b");
    assertEquals(result.override?.reason, "upstream is down");

    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.overrides?.deploy.outcome, "skipped");
    assertEquals(loaded?.record.overrides?.deploy.actor, "operator-b");
  });
});

Deno.test("a settled target cannot be forced", async () => {
  // The record is the account of what happened; rewriting a settled outcome
  // would make it say something untrue.
  for (const status of ["succeeded", "failed", "skipped"] as const) {
    await withTempStore(async (store) => {
      const runId = await seed(store, {
        targets: {
          deploy: { status, meta: {} },
          applyProduction: { status: "pending", meta: {} },
        },
      });
      const result = await forceTarget(new CD(), {
        runId,
        target: "deploy",
        outcome: "succeeded",
        stateStore: store,
        readEnv: () => undefined,
      });
      assertEquals(result.ok, false, status);
      assertEquals(result.denial, "already_settled");
      assertStringIncludes(result.message, status);
      assertEquals((await store.getRun(runId))?.record.overrides, undefined);
    });
  }
});

Deno.test("a target the build declares unforceable is refused", async () => {
  await withTempStore(async (store) => {
    const runId = await seed(store);
    const result = await forceTarget(new CD(), {
      runId,
      target: "applyProduction",
      outcome: "succeeded",
      stateStore: store,
      readEnv: () => undefined,
    });
    assertEquals(result.ok, false);
    assertEquals(result.denial, "unforceable");
    assertStringIncludes(result.message, "applyProduction");
    assertEquals((await store.getRun(runId))?.record.overrides, undefined);
  });
});

Deno.test("a terminal run, an unknown run and an unknown target are refused", async () => {
  await withTempStore(async (store) => {
    const terminal = await seed(store, { status: "succeeded" });
    assertEquals(
      (await forceTarget(new CD(), {
        runId: terminal,
        target: "deploy",
        outcome: "skipped",
        stateStore: store,
        readEnv: () => undefined,
      })).denial,
      "run_terminal",
    );
    assertEquals(
      (await forceTarget(new CD(), {
        runId: terminal,
        target: "nope",
        outcome: "skipped",
        stateStore: store,
        readEnv: () => undefined,
      })).denial,
      // The run is checked first: a terminal run has no plan to name a target in.
      "run_terminal",
    );
    assertEquals(
      (await forceTarget(new CD(), {
        runId: "no-such-run",
        target: "deploy",
        outcome: "skipped",
        stateStore: store,
        readEnv: () => undefined,
      })).denial,
      "unknown_run",
    );
  });

  await withTempStore(async (store) => {
    const runId = await seed(store);
    const result = await forceTarget(new CD(), {
      runId,
      target: "nope",
      outcome: "skipped",
      stateStore: store,
      readEnv: () => undefined,
    });
    assertEquals(result.denial, "unknown_target");
    assertStringIncludes(result.message, "nope");
  });
});

Deno.test("two concurrent forces of different targets both land", async () => {
  // The write is a compare-and-swap, so the loser re-reads and re-applies onto
  // the winner's record rather than clobbering it. Both overrides must survive.
  class Open extends Build {
    deploy = target().executes(() => {});
    applyProduction = target().executes(() => {});
  }
  await withTempStore(async (store) => {
    const runId = await seed(store);
    const force = (name: string) =>
      forceTarget(new Open(), {
        runId,
        target: name,
        outcome: "skipped",
        stateStore: store,
        readEnv: () => undefined,
      });
    const [a, b] = await Promise.all([
      force("deploy"),
      force("applyProduction"),
    ]);
    assertEquals(a.ok, true, a.message);
    assertEquals(b.ok, true, b.message);

    const record = (await store.getRun(runId))?.record;
    assertEquals(record?.overrides?.deploy.outcome, "skipped");
    assertEquals(record?.overrides?.applyProduction.outcome, "skipped");
  });
});

Deno.test("an override round-trips through the record parser", async () => {
  await withTempStore(async (store) => {
    const runId = await seed(store);
    await forceTarget(new CD(), {
      runId,
      target: "deploy",
      outcome: "succeeded",
      reason: "done by hand",
      stateStore: store,
      readEnv: () => undefined,
    });
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("no record");
    const round = parseRunRecord(JSON.stringify(loaded.record));
    assertEquals(round.overrides?.deploy, loaded.record.overrides?.deploy);
  });
});
