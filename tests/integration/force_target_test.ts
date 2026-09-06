// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for `zuke force` — settling a target of a live run without
 * running it, driven through the real CLI.
 *
 * What these prove that a unit test cannot: the override written by one process
 * is honoured by the executor in the next, the forced target's body genuinely
 * never runs while its dependents do, and the refusals reach an operator as an
 * exit code and a message rather than a silent no-op.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Records which bodies actually executed, across every run in a test. */
const ran: string[] = [];

/**
 * A build that parks on a gate, so a force can be written while it is
 * suspended and honoured when it resumes. `report` depends on the gated
 * `migrate`, so a forced `migrate` must still let `report` run.
 */
class Pipeline extends Build {
  gate = target()
    .waitsFor((s) => s.on(externalSignal("go")))
    .executes(() => void ran.push("gate"));
  migrate = target().dependsOn(this.gate).executes(() =>
    void ran.push("migrate")
  );
  report = target().dependsOn(this.migrate).executes(() =>
    void ran.push("report")
  );
  override unforceable() {
    return [this.report];
  }
}

/** The id of the (single) run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** The persisted record for run `id`. */
async function recordOf(dir: string, id: string) {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  if (got === null) throw new Error(`no run record for ${id}`);
  return got.record;
}

/** Start the pipeline and leave it suspended at the gate. */
async function suspended(dir: string): Promise<string> {
  ran.length = 0;
  const { code } = await runCli(Pipeline, ["report", "--state"]);
  assertEquals(code, 0);
  const id = await onlyRunId(dir);
  assertEquals((await recordOf(dir, id)).status, "suspended");
  return id;
}

Deno.test("a forced skip settles the target without running it, and dependents run", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);

    const forced = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "--outcome",
      "skipped",
      "--reason",
      "already applied out of band",
      "--actor",
      "operator-b",
    ]);
    assertEquals(forced.code, 0, forced.err);
    assertStringIncludes(forced.out, "skipped");

    const resumed = await runCli(Pipeline, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0, resumed.err);

    // The forced body never ran; the gate and the dependent did.
    assertEquals(ran.includes("migrate"), false, ran.join(","));
    assertEquals(ran.includes("report"), true, ran.join(","));

    const record = await recordOf(dir, id);
    assertEquals(record.targets.migrate.status, "skipped");
    assertEquals(record.targets.report.status, "succeeded");
    assertEquals(record.overrides?.migrate.actor, "operator-b");
    assertEquals(
      record.overrides?.migrate.reason,
      "already applied out of band",
    );
  });
});

Deno.test("a forced success settles the target as succeeded without running it", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    assertEquals(
      (await runCli(Pipeline, [
        "force",
        id,
        "migrate",
        "--outcome",
        "succeeded",
        "--reason",
        "ran the migration by hand",
      ])).code,
      0,
    );
    assertEquals(
      (await runCli(Pipeline, ["resume", id, "--signal", "go"])).code,
      0,
    );
    assertEquals(ran.includes("migrate"), false, ran.join(","));
    const record = await recordOf(dir, id);
    // Recorded as succeeded, which is what makes a later cancellation
    // compensate it — the operator asserted its effects exist.
    assertEquals(record.targets.migrate.status, "succeeded");
  });
});

Deno.test("runs show names the override, who set it and why", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    assertEquals(
      (await runCli(Pipeline, [
        "force",
        id,
        "migrate",
        "--outcome",
        "skipped",
        "--reason",
        "upstream is down",
        "--actor",
        "operator-b",
      ])).code,
      0,
    );
    const shown = await runCli(Pipeline, ["runs", "show", id]);
    assertEquals(shown.code, 0);
    assertStringIncludes(shown.out, "forced:");
    assertStringIncludes(shown.out, "migrate: skipped by operator-b");
    assertStringIncludes(shown.out, "upstream is down");
  });
});

Deno.test("an unforceable target is refused and nothing is recorded", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    const refused = await runCli(Pipeline, [
      "force",
      id,
      "report",
      "--outcome",
      "succeeded",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "unforceable");
    assertEquals((await recordOf(dir, id)).overrides, undefined);
  });
});

Deno.test("a settled target is refused after the run has moved past it", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    assertEquals(
      (await runCli(Pipeline, ["resume", id, "--signal", "go"])).code,
      0,
    );
    // The whole run finished, so every target settled.
    const refused = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "--outcome",
      "skipped",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "already");
  });
});

Deno.test("force validates its arguments before touching the store", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);

    const noOutcome = await runCli(Pipeline, ["force", id, "migrate"]);
    assertEquals(noOutcome.code, 1);
    assertStringIncludes(noOutcome.err, "--outcome must be one of");

    const badOutcome = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "--outcome",
      "cancelled",
    ]);
    assertEquals(badOutcome.code, 1);
    assertStringIncludes(badOutcome.err, "cancelled");

    const noTarget = await runCli(Pipeline, ["force", id]);
    assertEquals(noTarget.code, 1);
    assertStringIncludes(noTarget.err, "Usage: zuke force");

    assertEquals((await recordOf(dir, id)).overrides, undefined);
  });
});
