// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a canary rollout driven through the real CLI. Every way a
 * rollout can end badly — a failed analysis, `zuke cancel`, a rollback run by
 * hand — reaches the platform's one `abort`; a good one promotes after the
 * approval signal, in a later `main()` that reads what the first one staged.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { canary } from "../../packages/canary/mod.ts";
import { FakePlatform } from "../../packages/canary/tests/_platform.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The platform every build below drives; reset per test. */
let platform = new FakePlatform();

/** Whether the analysis passes. */
let healthy = true;

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => platform.describe(),
      stage: (ctx) => platform.stage(ctx),
      expose: (percent, ctx) => platform.expose(percent, ctx),
      promote: (ctx) => platform.promote(ctx),
      abort: (ctx) => platform.abort(ctx),
    })
      .steps(10, 50)
      .analysis({
        name: "health",
        validate: () => {
          if (!healthy) throw new Error("error ratio 0.3 above 0.01");
        },
      })
      .approval("approved")
      .lock((l) => l.lockKey("deploy", "api").withTtl("1h"))
  );
  ship = target()
    .description("Announce the release")
    .dependsOn(this.rollout.promote)
    .executes(() => {});
}

/** The id of the only run under `dir`. */
async function onlyRun(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** Reset the shared fakes before a test. */
function fresh(): void {
  platform = new FakePlatform();
  healthy = true;
}

Deno.test("--list shows the rollout's targets under its field", async () => {
  fresh();
  const { code, out } = await runCli(Deploy, ["--list"]);
  assertEquals(code, 0);
  for (
    const name of [
      "rollout.stage",
      "rollout.step1.expose",
      "rollout.step2.analyze",
      "rollout.approve",
      "rollout.promote",
      "rollout.abort",
    ]
  ) {
    assertStringIncludes(out, name);
  }
});

Deno.test("a rollout parks at approval, and the signal promotes it in a later process", async () => {
  fresh();
  await withStateDir(async (dir) => {
    const parked = await runCli(Deploy, ["ship"]);
    assertEquals(parked.code, 0, parked.err);
    assertEquals(platform.calls, [
      "stage",
      "expose 10 rev-2",
      "expose 50 rev-2",
    ]);
    const id = await onlyRun(dir);
    const resumed = await runCli(Deploy, [
      "resume",
      id,
      "--signal",
      "approved",
    ]);
    assertEquals(resumed.code, 0, resumed.err);
    assertEquals(platform.calls.at(-1), "promote rev-2");
  });
});

Deno.test("a failed analysis rolls the rollout back and fails the run", async () => {
  fresh();
  healthy = false;
  await withStateDir(async (dir) => {
    const { code, out, err } = await runCli(Deploy, ["ship"]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "error ratio 0.3 above 0.01");
    assertEquals(platform.calls, ["stage", "expose 10 rev-2", "abort rev-1"]);
    const run = await new FileSystemStateStore(dir, defaultStateHost).getRun(
      await onlyRun(dir),
    );
    assertEquals(run?.record.status, "cancelled");
  });
});

Deno.test("zuke cancel on a parked rollout runs the same rollback", async () => {
  fresh();
  await withStateDir(async (dir) => {
    await runCli(Deploy, ["ship"]);
    const cancelled = await runCli(Deploy, ["cancel", await onlyRun(dir)]);
    assertEquals(cancelled.code, 0, cancelled.err);
    assertEquals(platform.calls.at(-1), "abort rev-1");
    // The rollout's lock went with it: a new rollout can start.
    const again = await runCli(Deploy, ["rollout.stage"]);
    assertEquals(again.code, 0, again.err);
  });
});

Deno.test("a rollback run by hand has no recorded state to read", async () => {
  fresh();
  await withStateDir(async () => {
    const { code } = await runCli(Deploy, ["rollout.abort"]);
    assertEquals(code, 0);
    assertEquals(platform.calls, ["abort -"]);
  });
});
