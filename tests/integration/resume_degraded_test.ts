/**
 * Integration: a run whose state store dropped one write is recorded
 * `degraded`, and `zuke resume` refuses it until `--resume-degraded` overrides
 * the refusal. Driven through the real CLI `main()` (via {@link runCli}) against
 * a store that fails one `putRun` and then heals — the store hiccup that leaves
 * the record's per-target progress unprovable.
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
 * A real store that drops the first write recording `deploy` as succeeded, then
 * behaves normally — the best-effort write loss the `degraded` flag exists for.
 */
class FlakyStore extends FileSystemStateStore {
  /** Cleared once the write has been dropped, so the store heals. */
  dropDeploySettled = true;
  /** Fail the targeted write once; otherwise persist for real. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: true }> {
    if (
      this.dropDeploySettled &&
      record.targets.deploy?.status === "succeeded"
    ) {
      this.dropDeploySettled = false;
      return Promise.reject(new Error("store hiccup"));
    }
    return super.putRun(record, expected);
  }
}

Deno.test("a resume refuses a degraded record and proceeds with --resume-degraded", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    const store = new FlakyStore(`${dir}/runs`, defaultStateHost);
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

    // The run suspends at the gate; the dropped write leaves it degraded.
    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["deploy"]);
    const runId = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(runId))?.record.degraded, true);

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

    // With the override the run continues; deploy settled with an endedAt, so
    // the record proves it and it is not repeated.
    const forced = await runCli(CD, [
      "resume",
      runId,
      "--signal",
      "approve",
      "--resume-degraded",
    ]);
    assertEquals(forced.code, 0);
    assertEquals(log, ["deploy", "promote"]);
    assertEquals((await store.getRun(runId))?.record.status, "succeeded");
  });
});
