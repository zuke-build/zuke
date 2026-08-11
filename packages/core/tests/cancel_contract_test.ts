/**
 * The observable contract of `zuke cancel`, pinned exactly.
 *
 * Written before the settlement machinery was generalised so that a run can be
 * settled `failed` by a reaping sweep as well as `cancelled` by an operator. The
 * generalisation must not change one byte of what `zuke cancel` already does:
 * the requester's promote plane runs these paths from a pinned image, so a
 * merged change to them stays dormant until a deployment moves — which is the
 * worst way to find out that an audit event changed shape.
 *
 * These tests assert the things a caller or an operator can actually see: the
 * returned result, the record's terminal status, and the audit events, field by
 * field. They are deliberately more literal than the tests around them.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  messageOf,
} from "./_assert.ts";
import { ForeignRunError } from "../src/ownership.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { cancelRun } from "../src/cancel.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import type { RunEvent, RunRecord } from "../src/state/types.ts";

/** Run `fn` with a temp filesystem store, cleaned up afterwards. */
async function withTempStore(
  fn: (store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost));
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** The single run in `store`. */
async function onlyRun(store: FileSystemStateStore): Promise<RunRecord> {
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  const got = await store.getRun(runs[0].id);
  if (got === null) throw new Error("the run vanished");
  return got.record;
}

/** An event with its timestamp dropped, so shapes compare without a clock. */
function shapeOf(event: RunEvent): Omit<RunEvent, "at"> {
  const { at: _at, ...rest } = event;
  return rest;
}

Deno.test("cancel settles the record `cancelled` and reports what it undid", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class Cd extends Build {
      rollback = target().unlisted().executes(() =>
        void undone.push("rollback")
      );
      deploy = target().onCancel(this.rollback).executes(() => {});
      hold = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "never", isSatisfied: () => false })
      );
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.hold, { silent: true, stateStore: store });

    const before = await onlyRun(store);
    assertEquals(before.status, "suspended");

    const result = await cancelRun(build, {
      runId: before.id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });

    // The returned shape, field by field.
    assertEquals(result.runId, before.id);
    assertEquals(result.status, "cancelled");
    assertEquals(result.noop, false);
    assertEquals(result.compensated, ["rollback"]);
    assertEquals(result.failures, []);
    assertEquals(undone, ["rollback"]);

    const after = await onlyRun(store);
    assertEquals(after.status, "cancelled");

    // The audit trail: one `compensate` per attempt, then one `cancel` summary.
    const trail = after.events.filter((e) =>
      e.tool === "compensate" || e.tool === "cancel"
    );
    assertEquals(trail.map(shapeOf), [
      {
        tool: "compensate",
        actor: "ops",
        outcome: "ok",
        args: { target: "deploy" },
        detail: "deploy → rollback",
      },
      {
        tool: "cancel",
        actor: "ops",
        outcome: "ok",
        args: {},
        detail: "ran 1 compensation(s)",
      },
    ]);
  });
});

Deno.test("cancel with nothing to undo says so, in those words", async () => {
  await withTempStore(async (store) => {
    class Cd extends Build {
      hold = target().waitsFor((s) =>
        s.on({ descriptor: "never", isSatisfied: () => false })
      );
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.hold, { silent: true, stateStore: store });
    const before = await onlyRun(store);

    const result = await cancelRun(build, {
      runId: before.id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.compensated, []);
    assertEquals(result.status, "cancelled");

    const after = await onlyRun(store);
    const summary = after.events.filter((e) => e.tool === "cancel");
    assertEquals(summary.map(shapeOf), [{
      tool: "cancel",
      actor: "ops",
      outcome: "ok",
      args: {},
      detail: "no compensations",
    }]);
  });
});

Deno.test("cancelling an already-terminal run is a no-op that adds no events", async () => {
  await withTempStore(async (store) => {
    class Cd extends Build {
      ship = target().executes(() => {});
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.ship, { silent: true, stateStore: store });
    const before = await onlyRun(store);
    assertEquals(before.status, "succeeded");
    const eventsBefore = before.events.length;

    const result = await cancelRun(build, {
      runId: before.id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.noop, true);
    assertEquals(result.status, "succeeded");
    assertEquals(result.compensated, []);
    assertEquals(result.failures, []);

    // Untouched: a no-op leaves no trace, including no audit event.
    const after = await onlyRun(store);
    assertEquals(after.status, "succeeded");
    assertEquals(after.events.length, eventsBefore);
  });
});

Deno.test("a run left mid-cancellation is finalized without re-running compensations", async () => {
  // The recovery path: a canceller that crashed left the record `cancelling`.
  // A second cancel settles it rather than compensating twice, because a
  // compensation that is not idempotent is more dangerous run twice than left
  // half-done.
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class Cd extends Build {
      rollback = target().unlisted().executes(() =>
        void undone.push("rollback")
      );
      deploy = target().onCancel(this.rollback).executes(() => {});
      hold = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "never", isSatisfied: () => false })
      );
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.hold, { silent: true, stateStore: store });
    const before = await onlyRun(store);

    // Strand it, as a killed canceller would.
    const loaded = await store.getRun(before.id);
    if (loaded === null) throw new Error("the run vanished");
    const stranded = structuredClone(loaded.record);
    stranded.status = "cancelling";
    assertEquals((await store.putRun(stranded, loaded.version)).ok, true);

    const result = await cancelRun(build, {
      runId: before.id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.noop, false);
    assertEquals(result.compensated, []);
    assertEquals(undone, []); // never compensated twice

    const after = await onlyRun(store);
    assertEquals(after.status, "cancelled");
  });
});

Deno.test("a failing compensation is recorded but does not stop the cancel", async () => {
  await withTempStore(async (store) => {
    class Cd extends Build {
      rollback = target().unlisted().executes(() => {
        throw new Error("rollback exploded");
      });
      deploy = target().onCancel(this.rollback).executes(() => {});
      hold = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "never", isSatisfied: () => false })
      );
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.hold, { silent: true, stateStore: store });
    const before = await onlyRun(store);

    const result = await cancelRun(build, {
      runId: before.id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.compensated, []);
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].target, "rollback");
    assertEquals(result.failures[0].forTarget, "deploy");

    const after = await onlyRun(store);
    const trail = after.events.filter((e) =>
      e.tool === "compensate" || e.tool === "cancel"
    );
    assertEquals(trail.map(shapeOf), [
      {
        tool: "compensate",
        actor: "ops",
        outcome: "error",
        args: { target: "deploy" },
        detail: "deploy → rollback",
      },
      {
        tool: "cancel",
        actor: "ops",
        outcome: "error",
        args: {},
        detail: "ran 0 compensation(s), 1 failed",
      },
    ]);
  });
});

Deno.test("cancel refuses a run another build owns, and undoes nothing", async () => {
  // A settlement runs *this* build's compensations, so a run belonging to
  // another build is refused before the lock is taken. Reported rather than
  // silently skipped: this path was handed one run by name.
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class Cd extends Build {
      rollback = target().unlisted().executes(() =>
        void undone.push("rollback")
      );
      deploy = target().onCancel(this.rollback).executes(() => {});
      hold = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on({ descriptor: "never", isSatisfied: () => false })
      );
    }
    const build = new Cd();
    discoverTargets(build);
    await execute(build, build.hold, {
      silent: true,
      stateStore: store,
      readEnv: (name) => name === "ZUKE_BUILD_ID" ? "acme/api" : undefined,
    });
    const before = await onlyRun(store);
    assertEquals(before.buildId, "acme/api");

    const error = await assertRejects(() =>
      cancelRun(build, {
        runId: before.id,
        stateStore: store,
        silent: true,
        actor: "ops",
        readEnv: (name) => name === "ZUKE_BUILD_ID" ? "acme/web" : undefined,
      }), ForeignRunError);
    assertStringIncludes(messageOf(error), "acme/api");

    // No compensation ran, and the record is untouched — not even `cancelling`.
    assertEquals(undone, []);
    const after = await onlyRun(store);
    assertEquals(after.status, "suspended");
    assertEquals(after.events.length, before.events.length);
  });
});
