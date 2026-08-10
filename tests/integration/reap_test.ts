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

Deno.test("time spent parked at a gate is not charged against the deadline", async () => {
  // The documented contract, and the one it is easiest to get backwards. A
  // 45-minute budget behind a long approval gate would otherwise be exhausted
  // before anyone could approve, and the run would be settled the instant it
  // woke up — killed by the deadline it was never spending.
  class Cd extends Build {
    override deadline() {
      return "45m";
    }
    hold = target().waitsFor((s) => s.on(externalSignal("go")));
    ship = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Cd, ["ship"])).code, 0); // suspended at the gate
    const id = await onlyRunId(dir);
    const store = new FileSystemStateStore(dir, defaultStateHost);

    // Park it for two hours — well past the 45-minute budget.
    const loaded = await store.getRun(id);
    if (loaded === null) throw new Error("the run vanished");
    const parked = structuredClone(loaded.record);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    parked.updatedAt = twoHoursAgo;
    parked.deadlineAt = new Date(
      Date.parse(twoHoursAgo) + 45 * 60 * 1000,
    ).toISOString();
    assertEquals((await store.putRun(parked, loaded.version)).ok, true);

    // Approved: the run resumes, and its budget is pushed forward by what it
    // spent parked — so it is not already expired the moment it wakes up, which
    // is what the next sweep would otherwise settle it for.
    const resumed = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    const after = await store.getRun(id);
    assertEquals(after?.record.status, "succeeded");

    const deadline = Date.parse(after?.record.deadlineAt ?? "");
    assertEquals(Number.isFinite(deadline), true);
    // Still ahead of now: the two parked hours were given back, so roughly the
    // original 45 minutes of running budget remain.
    assertEquals(deadline > Date.now(), true);
  });
});

Deno.test("a deadline added after a run suspended does not strand it", async () => {
  // A build gains a deadline between the run suspending and the resume. The
  // resume adopts the record's own deadline, so nothing parses the build's — a
  // throw there would leave the run `running` to be reaped, resumed, and
  // stranded again on every sweep, forever.
  class Before extends Build {
    hold = target().waitsFor((s) => s.on(externalSignal("go")));
    ship = target().dependsOn(this.hold).executes(() => {});
  }
  class After extends Build {
    override deadline() {
      return "not-a-duration";
    }
    hold = target().waitsFor((s) => s.on(externalSignal("go")));
    ship = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Before, ["ship"])).code, 0);
    const id = await onlyRunId(dir);

    const resumed = await runCli(After, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    assertEquals((await store.getRun(id))?.record.status, "succeeded");
  });
});
