// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a run that **permanently lost** a state write is recorded
 * `degraded`, and `zuke resume` refuses it until `--resume-degraded` overrides
 * the refusal. Driven through the real CLI `main()` (via {@link runCli}) against a
 * store that conflicts every write settling `deploy` — a foreign writer winning
 * the compare-and-swap race until the writer's retry budget runs out, which is
 * how a settlement is really lost.
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
import type { RunRecord } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/**
 * A real store whose compare-and-swap always conflicts on a write recording
 * `deploy` as succeeded, so the writer exhausts its retries, adopts the
 * freshly-read record and loses that settlement for good. Every other write
 * persists normally.
 */
class LosesDeploySettlement extends FileSystemStateStore {
  /** Clear before the resume, so only the original run loses a write. */
  losing = true;
  /** Conflict on the targeted write; otherwise persist for real. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: true }> {
    if (this.losing && record.targets.deploy?.status === "succeeded") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("a resume refuses a degraded record and proceeds with --resume-degraded", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    const store = new LosesDeploySettlement(`${dir}/runs`, defaultStateHost);
    class CD extends Build {
      override stateStore() {
        return store;
      }
      deploy = target().executes(() => void log.push("deploy"));
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on(externalSignal("approve"))
      );
      promote = target().dependsOn(this.gate).executes(() =>
        void log.push("promote")
      );
    }

    // The run suspends at the gate; the lost write leaves it degraded, and
    // leaves the succeeded deploy recorded as still running.
    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["deploy"]);
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.degraded, true);
    assertEquals(
      (await store.getRun(runId))?.record.targets.deploy.status,
      "running",
    );
    store.losing = false; // the racing writer is gone by the time we resume

    // `runs show` surfaces it, so the operator can decide.
    const shown = await runCli(CD, ["runs", "show", runId]);
    assertStringIncludes(shown.out, "degraded: yes");

    // A plain resume refuses, naming the run and the override, and leaves the
    // run suspended so the override can still pick it up.
    const refused = await runCli(CD, [
      "resume",
      runId,
      "--signal",
      "approve",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, runId);
    assertStringIncludes(refused.err, "--resume-degraded");
    assertEquals(log, ["deploy"]); // nothing ran
    assertEquals((await store.getRun(runId))?.record.status, "suspended");

    // With the override the run continues, and the risk the refusal named is
    // real: deploy is recorded `running`, so the resume runs it a second time.
    const forced = await runCli(CD, [
      "resume",
      runId,
      "--signal",
      "approve",
      "--resume-degraded",
    ]);
    assertEquals(forced.code, 0);
    assertEquals(log, ["deploy", "deploy", "promote"]);
    assertEquals((await store.getRun(runId))?.record.status, "succeeded");
  });
});
