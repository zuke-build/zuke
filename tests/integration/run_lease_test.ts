/**
 * Integration tests for the run lease — a process's claim that it is the one
 * working on a run, driven through the real CLI.
 *
 * The pairing these protect: a record that says `running` always has a live
 * holder. That is what lets a sweep tell an abandoned run from a working one,
 * and it is why a resume refuses a run whose previous holder has not let go.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The id of the (single) run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

Deno.test("a run holds a lease while it runs, and releases it when it settles", async () => {
  // The pairing a reaping sweep depends on: a record that says `running` always
  // has a live holder, and the claim goes the moment the run stops being this
  // process's to work on.
  let heldDuringRun = false;

  class Ci extends Build {
    work = target().effect("announce", async (ctx) => {
      const dir = Deno.env.get("ZUKE_STATE_DIR") ?? "";
      heldDuringRun = await Deno.stat(`${dir}/locks/zuke-run-${ctx.runId}.json`)
        .then(() => true, () => false);
    });
  }

  await withStateDir(async (dir) => {
    const { code } = await runCli(Ci, ["work"]);
    assertEquals(code, 0);
    assertEquals(heldDuringRun, true);
    const id = await onlyRunId(dir);
    // Released: the lock is gone rather than left to lapse at its TTL.
    const stillHeld = await Deno.stat(`${dir}/locks/zuke-run-${id}.json`)
      .then(() => true, () => false);
    assertEquals(stillHeld, false);
  });
});

Deno.test("a resume refuses a run whose previous holder is still live", async () => {
  // A lease outlives the process that took it, so a run whose owner has not let
  // go is not available — the refusal is what stops two processes working the
  // same run when one of them merely looks dead.
  class Cd extends Build {
    hold = target().waitsFor((s) => s.on(externalSignal("go")));
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Cd, ["done"])).code, 0); // suspended
    const id = await onlyRunId(dir);

    // Stand in for a killed holder: a lease over this run, held by nobody.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const taken = await store.acquireLock(
      `zuke-run-${id}`,
      { actor: "a-dead-process", runId: id, since: "2026-08-10T10:00:00.000Z" },
      60_000,
    );
    assertEquals(taken.ok, true);

    const refused = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(refused.code, 1);
  });
});
