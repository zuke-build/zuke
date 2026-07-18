/**
 * Integration: the wait/resume flow and services, driven through the real CLI.
 * A `waitsFor()` gate suspends a run to the state store; a later `resume`
 * command (a fresh `main()` call, i.e. a distinct "process") continues it. The
 * run id is read back from a {@link FileSystemStateStore} over the same temp
 * `ZUKE_STATE_DIR` the harness set — the seam that makes cross-process resumes
 * observable in one test.
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
  resumeWhen,
  service,
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

/** The persisted status of run `id` under `dir`. */
async function runStatus(dir: string, id: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  assertEquals(got !== null, true);
  return got === null ? "" : got.record.status;
}

Deno.test("a signal gate suspends, then resume delivers the signal and continues", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    let approvedBy: unknown;
    class CD extends Build {
      deploy = target().executes((ctx) => {
        log.push("deploy");
        return ctx.state.set({ at: "sit-7" });
      });
      gate = target()
        .dependsOn(this.deploy)
        .waitsFor((s) => s.on(externalSignal("approved")));
      promote = target().dependsOn(this.gate).executes((ctx) => {
        log.push("promote");
        approvedBy = ctx.signals.get("approved")?.data;
      });
    }

    // First process: runs deploy, suspends at the gate (a suspend is exit 0).
    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["deploy"]);
    const id = await onlyRunId(dir);
    assertEquals(await runStatus(dir, id), "suspended");

    // Second process: deliver the signal and continue. deploy is not re-run.
    const resumed = await runCli(CD, [
      "resume",
      id,
      "--signal",
      "approved",
      "--data",
      '{"by":"alice"}',
    ]);
    assertEquals(resumed.code, 0);
    assertEquals(log, ["deploy", "promote"]);
    assertEquals(approvedBy, { by: "alice" });

    // Third process: the run is done, so a second resume loses / errors.
    const again = await runCli(CD, ["resume", id, "--signal", "approved"]);
    assertEquals(again.code, 1);
  });
});

Deno.test("a predicate gate is re-evaluated by `resume --check`", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    let ready = false;
    class B extends Build {
      work = target().executes(() => void log.push("work"));
      gate = target()
        .dependsOn(this.work)
        .waitsFor((s) => s.on(resumeWhen(() => ready)));
      ship = target().dependsOn(this.gate).executes(() =>
        void log.push("ship")
      );
    }

    const first = await runCli(B, ["ship"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["work"]);
    const id = await onlyRunId(dir);
    assertEquals(await runStatus(dir, id), "suspended");

    // Predicate still false: the check re-suspends, nothing ships.
    const stillWaiting = await runCli(B, ["resume", "--check"]);
    assertEquals(stillWaiting.code, 0);
    assertEquals(log.includes("ship"), false);

    // Flip the predicate; the next check satisfies the gate and continues.
    ready = true;
    const checked = await runCli(B, ["resume", "--check"]);
    assertEquals(checked.code, 0);
    assertStringIncludes(checked.out, "Checked 1 suspended run(s); 0 failed.");
    assertEquals(log, ["work", "ship"]);
  });
});

Deno.test("a wait past its deadline times out on resume --check", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("never")).timeout(1));
    }
    const first = await runCli(B, ["gate"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);
    assertEquals(await runStatus(dir, id), "suspended");

    // The 1ms deadline is long past by the time the sweep runs → it fails.
    const checked = await runCli(B, ["resume", "--check"]);
    assertEquals(checked.code, 1);
    assertStringIncludes(checked.out, "1 failed.");
    assertEquals(await runStatus(dir, id), "failed");
  });
});

Deno.test("a service starts, gates its dependent on readiness, and is stopped", async () => {
  const log: string[] = [];
  let probes = 0;
  let stopped = false;
  class B extends Build {
    api = service()
      .start(() => ({
        stop: () => {
          stopped = true;
        },
      }))
      .readyWhen(() => ++probes >= 2); // not ready once, then ready
    smoke = target().dependsOn(this.api).executes(() => void log.push("smoke"));
  }
  const { code } = await runCli(B, ["smoke"]);
  assertEquals(code, 0);
  assertEquals(log, ["smoke"]);
  assertEquals(probes >= 2, true); // the dependent waited for readiness
  assertEquals(stopped, true); // the service was torn down after the run
});
