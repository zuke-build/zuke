// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a target's summary notes are durable, end to end through the
 * CLI `main()`. The notes a body reports land in the run record the build
 * writes, `zuke runs show` prints them on the target's line, and a dependent
 * target reads them back through `ctx.outcomeOf(...)`. A secret a note happens
 * to carry is redacted before it is written, like every other string in the
 * record.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  type RunRecord,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The id of the single run recorded under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0].id;
}

/** The full persisted record of run `id` under `dir`. */
async function loadRun(dir: string, id: string): Promise<RunRecord> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  if (got === null) throw new Error(`run ${id} not found`);
  return got.record;
}

Deno.test("summary notes land in the run record, in runs show, and in outcomeOf", async () => {
  await withStateDir(async (dir) => {
    const seen: string[] = [];
    class CI extends Build {
      test = target().executes((ctx) => {
        ctx.reportSummary({ Tests: 4094, Failed: 0 });
      });
      report = target().dependsOn(this.test).executes((ctx) => {
        for (const note of ctx.outcomeOf("test")?.summary ?? []) {
          seen.push(`${note.key}=${note.value}`);
        }
      });
    }
    const run = await runCli(CI, ["report"]);
    assertEquals(run.code, 0, run.err);
    assertEquals(seen, ["Tests=4094", "Failed=0"]);

    const id = await onlyRunId(dir);
    const record = await loadRun(dir, id);
    assertEquals(record.targets.test.summary, [
      { key: "Tests", value: "4094" },
      { key: "Failed", value: "0" },
    ]);
    assertEquals(record.targets.report.summary, undefined);

    const show = await runCli(CI, ["runs", "show", id]);
    assertEquals(show.code, 0);
    assertStringIncludes(show.out, "// Tests: 4094 · Failed: 0");
  });
});

Deno.test("a failed target's notes survive next to its error in runs show", async () => {
  await withStateDir(async (dir) => {
    class CI extends Build {
      test = target().executes((ctx) => {
        ctx.reportSummary({ Tests: 3, Failed: 1 });
        throw new Error("1 test failed");
      });
    }
    const run = await runCli(CI, ["test"]);
    assertEquals(run.code, 1);

    const id = await onlyRunId(dir);
    const record = await loadRun(dir, id);
    assertEquals(record.targets.test.status, "failed");
    assertEquals(record.targets.test.summary, [
      { key: "Tests", value: "3" },
      { key: "Failed", value: "1" },
    ]);

    const show = await runCli(CI, ["runs", "show", id]);
    assertEquals(show.code, 0);
    assertStringIncludes(show.out, "1 test failed  // Tests: 3 · Failed: 1");
  });
});
