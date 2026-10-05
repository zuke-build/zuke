// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `canary(...)`: the targets it builds, the order the platform
 * is driven in, and that every failure path reaches the one rollback with the
 * state `stage` recorded.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withTempStore } from "../../core/tests/_store.ts";
import {
  Build,
  cancelRun,
  discoverTargets,
  execute,
  resumeCheck,
  resumeRun,
  type StateStore,
  target,
} from "@zuke/core";
import {
  canary,
  type CanaryAnalysis,
  type CanaryAnalysisContext,
  type CanarySettings,
} from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import { FakePlatform } from "./_platform.ts";

/** A build whose `rollout` is the canary `configure` describes. */
function rolloutOf(
  platform: FakePlatform,
  configure: Configure<CanarySettings> = (c) => c,
) {
  return class extends Build {
    rollout = canary((c) => configure(c.platform(platform)));
    ship = target().dependsOn(this.rollout.promote).executes(() => {});
  };
}

/** Construct and discover a build. */
function built<B extends Build>(Ctor: new () => B): B {
  const b = new Ctor();
  discoverTargets(b);
  return b;
}

/** An analysis that fails on its `failOn`-th call, recording what it saw. */
function analysis(
  failOn = Infinity,
): CanaryAnalysis & { seen: CanaryAnalysisContext[] } {
  const seen: CanaryAnalysisContext[] = [];
  return {
    seen,
    name: "probe",
    validate(context) {
      seen.push(context);
      if (seen.length >= failOn) throw new Error(`unhealthy at ${seen.length}`);
    },
  };
}

/** The id of the only run in `store`. */
async function onlyRun(store: StateStore): Promise<string> {
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

Deno.test("a rollout stages, steps up, promotes, and names its targets under the field", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const b = built(rolloutOf(platform, (c) => c.steps(10, 50)));
    const names = [...discoverTargets(b).keys()];
    for (
      const name of [
        "rollout.stage",
        "rollout.step1.expose",
        "rollout.step2.expose",
        "rollout.promote",
        "rollout.abort",
      ]
    ) {
      assertEquals(names.includes(name), true, name);
    }
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(platform.calls, [
      "stage",
      "expose 10 rev-2",
      "expose 50 rev-2",
      "promote rev-2",
    ]);
  });
});

Deno.test("a failed analysis rolls back with the state stage recorded", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const check = analysis(2);
    const b = built(
      rolloutOf(platform, (c) => c.steps(10, 50).analysis(check)),
    );
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.cancelled, true);
    assertStringIncludes(String(result.error), "unhealthy at 2");
    assertEquals(platform.calls, [
      "stage",
      "expose 10 rev-2",
      "expose 50 rev-2",
      "abort rev-1",
    ]);
    // Each analysis saw where the rollout stood.
    assertEquals(check.seen.map((c) => [c.step, c.requested, c.exposure]), [
      [1, 10, 10],
      [2, 50, 50],
    ]);
    assertEquals(check.seen[0].target, "rollout.step1.analyze");
  });
});

Deno.test("a failed expose and a failed promote roll back", async () => {
  for (const failOn of ["expose", "promote"] as const) {
    await withTempStore(async (store) => {
      const platform = new FakePlatform();
      platform.failOn = failOn;
      const b = built(rolloutOf(platform, (c) => c.steps(10)));
      const result = await execute(b, b.ship, {
        silent: true,
        stateStore: store,
      });
      assertEquals(result.cancelled, true, failOn);
      assertEquals(platform.calls.at(-1), "abort rev-1", failOn);
    });
  }
});

Deno.test("a stage that fails part-way still rolls back what it left", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    platform.failOn = "stage";
    const b = built(rolloutOf(platform, (c) => c.steps(10)));
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertEquals(platform.calls, ["stage", "abort rev-1"]);
  });
});

Deno.test("analyses are handed the exposure achieved, not just the one requested", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform("replicas");
    platform.achieve = (percent) => percent === 10 ? 12.5 : percent;
    const check = analysis();
    const b = built(rolloutOf(platform, (c) => c.steps(10).analysis(check)));
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(check.seen[0].exposure, 12.5);
    assertEquals(check.seen[0].requested, 10);
  });
});

Deno.test("an exposure outside 0 to 100 fails the step and rolls back", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    platform.achieve = () => Number.NaN;
    const b = built(rolloutOf(platform, (c) => c.steps(10)));
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.cancelled, true);
    assertStringIncludes(String(result.error), "expected 0 to 100");
    assertEquals(platform.calls.at(-1), "abort rev-1");
  });
});

Deno.test("an inline bake runs its analyses in flight and stops at the first failure", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const check = analysis(3);
    const b = built(
      rolloutOf(
        platform,
        (c) => c.steps(10).bake("5s").analysisInterval(10).analysis(check),
      ),
    );
    const started = Date.now();
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.cancelled, true);
    assertEquals(Date.now() - started < 3_000, true);
    assertEquals(check.seen[0].target, "rollout.step1.bake");
    assertEquals(platform.calls.at(-1), "abort rev-1");
  });
});

Deno.test("an inline bake that stays healthy runs to its end, then analyses once more", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const check = analysis();
    const b = built(
      rolloutOf(
        platform,
        (c) => c.steps(10).bake(80).analysisInterval(20).analysis(check),
      ),
    );
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    const targets = check.seen.map((c) => c.target);
    assertEquals(targets.includes("rollout.step1.bake"), true);
    assertEquals(targets.at(-1), "rollout.step1.analyze");
  });
});

Deno.test("the lock is held from staging to promotion, and released after", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const held: boolean[] = [];
    const probe = {
      validate: async () => {
        const taken = await store.acquireLock(
          "deploy-api",
          { actor: "other", runId: "other", since: "t" },
          60_000,
        );
        held.push(!taken.ok);
        if (taken.ok) await store.releaseLock("deploy-api", taken.token);
      },
    };
    const b = built(
      rolloutOf(
        platform,
        (c) =>
          c.steps(10).analysis(probe).lock((l) =>
            l.key("deploy-api").withTtl("1h")
          ),
      ),
    );
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(held, [true]);
    const free = await store.acquireLock(
      "deploy-api",
      { actor: "other", runId: "other", since: "t" },
      60_000,
    );
    assertEquals(free.ok, true);
  });
});

Deno.test("an approval gate parks the rollout, and the signal promotes it", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const Rollout = rolloutOf(
      platform,
      (c) => c.steps(10).approval("canary-approved"),
    );
    const b = built(Rollout);
    const parked = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(parked.suspended, true);
    assertEquals(platform.calls, ["stage", "expose 10 rev-2"]);
    const resumed = await resumeRun(new Rollout(), {
      runId: await onlyRun(store),
      signal: "canary-approved",
      stateStore: store,
      silent: true,
    });
    assertEquals(resumed.ok, true);
    // The resumed process promotes the candidate the first one staged.
    assertEquals(platform.calls.at(-1), "promote rev-2");
  });
});

Deno.test("an approval that times out rolls back", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const Rollout = rolloutOf(
      platform,
      (c) => c.steps(10).approval("canary-approved").approvalTimeout(1),
    );
    const b = built(Rollout);
    await execute(b, b.ship, { silent: true, stateStore: store });
    await new Promise((r) => setTimeout(r, 10));
    await resumeCheck(new Rollout(), { stateStore: store, silent: true });
    assertEquals(platform.calls.at(-1), "abort rev-1");
    const run = await store.getRun(await onlyRun(store));
    assertEquals(run?.record.status, "cancelled");
  });
});

Deno.test("zuke cancel on a parked rollout runs the same rollback", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const Rollout = rolloutOf(platform, (c) => c.steps(10).approval("ok"));
    const b = built(Rollout);
    await execute(b, b.ship, { silent: true, stateStore: store });
    await cancelRun(new Rollout(), {
      runId: await onlyRun(store),
      stateStore: store,
      silent: true,
    });
    assertEquals(platform.calls.at(-1), "abort rev-1");
  });
});

Deno.test("a durable bake parks the run until its time is up", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const check = analysis();
    const Rollout = rolloutOf(
      platform,
      (c) => c.steps(10).bake(60).durable().analysis(check),
    );
    const b = built(Rollout);
    const parked = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(parked.suspended, true);
    // Too early: still parked, nothing analysed in flight.
    await resumeCheck(new Rollout(), { stateStore: store, silent: true });
    assertEquals(platform.calls.includes("promote rev-2"), false);
    assertEquals(check.seen.length, 0);
    await new Promise((r) => setTimeout(r, 80));
    await resumeCheck(new Rollout(), { stateStore: store, silent: true });
    assertEquals(platform.calls.at(-1), "promote rev-2");
    assertEquals(check.seen.map((c) => c.target), ["rollout.step1.analyze"]);
  });
});

Deno.test("a stepless canary soaks and analyses once before promoting", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform("channel");
    const check = analysis();
    const Rollout = rolloutOf(platform, (c) => c.bake(10).analysis(check));
    const b = built(Rollout);
    assertEquals(discoverTargets(b).has("rollout.soak.bake"), true);
    const result = await execute(b, b.ship, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(platform.calls, ["stage", "promote rev-2"]);
    assertEquals([check.seen[0].step, check.seen[0].exposure], [0, 0]);
  });
});

Deno.test("abort run by hand gets no recorded state", async () => {
  await withTempStore(async (store) => {
    const platform = new FakePlatform();
    const b = built(rolloutOf(platform, (c) => c.steps(10)));
    const result = await execute(b, b.rollout.abort, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(platform.calls, ["abort -"]);
  });
});
