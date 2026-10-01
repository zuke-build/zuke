// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `.onFailure(...)` driven through the real CLI. A failing check
 * cancels the run and rolls back what succeeded — in the same process, and
 * across a suspend/resume boundary, where the target being rolled back ran in an
 * earlier process and only its recorded state crosses over.
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
  type RunRecord,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The single run the CLI persisted under `dir`. */
async function onlyRun(dir: string): Promise<RunRecord> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  const got = await store.getRun(runs[0].id);
  if (got === null) throw new Error("run not found");
  return got.record;
}

Deno.test("a failing check with .onFailure cancel-run rolls the deploy back", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class Deploy extends Build {
      deploy = target()
        .executes((ctx) => {
          log.push("deploy");
          return ctx.state.set({ revision: "api-00042" });
        })
        .onCancel(() => this.rollback);
      verify = target()
        .dependsOn(this.deploy)
        .onFailure(() => "cancel-run")
        .executes(() => {
          log.push("verify");
          throw new Error("health returned 503");
        });
      rollback = target().unlisted().executes((ctx) =>
        void log.push(`rollback:${ctx.state.get().revision}`)
      );
    }

    const res = await runCli(Deploy, ["verify"]);
    assertEquals(res.code, 1);
    assertEquals(log, ["deploy", "verify", "rollback:api-00042"]);
    assertStringIncludes(res.out, "verify failed and its .onFailure(...)");

    const record = await onlyRun(dir);
    assertEquals(record.status, "cancelled");
    assertEquals(record.targets.verify.status, "failed");
    assertStringIncludes(record.targets.verify.error ?? "", "503");
  });
});

Deno.test("a failure after a resume rolls back work an earlier process did", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class Canary extends Build {
      stage = target()
        .executes((ctx) => {
          log.push("stage");
          return ctx.state.set({ candidate: "api-00042" });
        })
        .onCancel(() => this.abort);
      approve = target()
        .dependsOn(this.stage)
        .waitsFor((s) => s.on(externalSignal("approved")));
      analyze = target()
        .dependsOn(this.approve)
        .onFailure(() => "cancel-run")
        .executes(() => {
          log.push("analyze");
          throw new Error("error ratio above threshold");
        });
      abort = target().unlisted().executes((ctx) =>
        void log.push(`abort:${ctx.state.get().candidate}`)
      );
    }

    // First process: stage runs, the run suspends at the gate.
    const first = await runCli(Canary, ["analyze"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["stage"]);
    const suspended = await onlyRun(dir);
    assertEquals(suspended.status, "suspended");

    // Second process: the signal passes the gate, analyze fails, and the run is
    // rolled back using the state the first process recorded.
    const second = await runCli(Canary, [
      "resume",
      suspended.id,
      "--signal",
      "approved",
    ]);
    assertEquals(second.code, 1);
    assertEquals(log, ["stage", "analyze", "abort:api-00042"]);
    assertEquals((await onlyRun(dir)).status, "cancelled");
  });
});
