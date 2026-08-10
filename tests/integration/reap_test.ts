/**
 * Integration tests for reaping, driven through the real CLI.
 *
 * The loop these close: a process killed mid-run leaves the run `running`, and a
 * resume only ever acts on `suspended` runs. Until something notices and moves
 * it, an effect that run recorded as owed waits forever. One
 * `zuke resume --check` now notices, moves it, and drives it — on the same pass.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
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

/** Leave the run in the state a killed process leaves: running, work still owed. */
async function strandAsKilled(dir: string, id: string): Promise<void> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  if (got === null) throw new Error("the run vanished");
  const record = structuredClone(got.record);
  record.status = "running";
  record.targets["publish"] = {
    status: "running",
    meta: {},
    effects: {
      announce: {
        status: "pending",
        intentAt: "2026-08-10T10:00:00.000Z",
        attempts: 1,
      },
    },
  };
  assertEquals((await store.putRun(record, got.version)).ok, true);
}

Deno.test("one sweep reaps an abandoned run and re-drives what it owed", async () => {
  // The whole point, end to end: nothing but `resume --check`, and the effect a
  // killed process left owed is performed.
  const drives: boolean[] = [];

  class Cd extends Build {
    publish = target().effect("announce", (ctx) => {
      drives.push(ctx.redriven);
    });
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Cd, ["publish"])).code, 0);
    const id = await onlyRunId(dir);
    assertEquals(drives, [false]);

    await strandAsKilled(dir, id);

    const swept = await runCli(Cd, ["resume", "--check"]);
    assertEquals(swept.code, 0);
    // Driven again, and told that a previous attempt already committed.
    assertEquals(drives, [false, true]);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const after = await store.getRun(id);
    assertEquals(after?.record.status, "succeeded");
    const row = after?.record.targets["publish"]?.effects?.["announce"];
    assertEquals(row?.status, "done");
    assertEquals(row?.attempts, 2);
    // The reap is on the record, so an operator can see why the run moved.
    assertEquals(
      after?.record.events.some((e) => e.tool === "reap"),
      true,
    );
  });
});

Deno.test("a sweep leaves a run alone while its holder is still there", async () => {
  // Slow is not dead. A live lease means someone is working on it, and taking
  // that run away would put two processes on it.
  const drives: string[] = [];

  class Cd extends Build {
    publish = target().effect("announce", () => {
      drives.push("announce");
    });
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Cd, ["publish"])).code, 0);
    const id = await onlyRunId(dir);
    await strandAsKilled(dir, id);

    // Someone is holding the run's lease — as a live process would be.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const held = await store.acquireLock(
      `zuke-run-${id}`,
      { actor: "the-owner", runId: id, since: "2026-08-10T10:00:00.000Z" },
      60_000,
    );
    assertEquals(held.ok, true);

    const swept = await runCli(Cd, ["resume", "--check"]);
    assertEquals(swept.code, 0);
    assertEquals(drives, ["announce"]); // not driven a second time

    const after = await store.getRun(id);
    assertEquals(after?.record.status, "running"); // untouched
  });
});

Deno.test("a run past its deadline is settled failed rather than resumed", async () => {
  const drives: string[] = [];

  class Cd extends Build {
    override deadline() {
      return "1ms";
    }
    publish = target().effect("announce", () => {
      drives.push("announce");
    });
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Cd, ["publish"])).code, 0);
    const id = await onlyRunId(dir);
    await strandAsKilled(dir, id);

    const swept = await runCli(Cd, ["resume", "--check"]);
    assertEquals(swept.code, 0);
    // Out of time: the owed effect is not re-driven, the run gets an answer.
    assertEquals(drives, ["announce"]);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const after = await store.getRun(id);
    assertEquals(after?.record.status, "failed");
  });
});
