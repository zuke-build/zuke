// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
  parameter,
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

Deno.test("a .waitsFor() gate inside a forEach fails loudly, never stranding the run", async () => {
  await withStateDir(async (dir) => {
    class CD extends Build {
      deployBatch = target().forEach(
        () => ["repo-a", "repo-b"],
        () => ({
          deploy: target().executes(() => {}),
          // A wait gate on a fan-out sub-target has no resume path. Before the
          // fix this returned exit 0 ("succeeded") while durably recording a
          // stranded "waiting" row the resume sweep could never reach.
          gate: target().waitsFor((s) => s.on(externalSignal("approved"))),
        }),
      );
    }
    const res = await runCli(CD, ["deployBatch"]);
    // Fails loudly with guidance — not a silent exit-0 success.
    assertEquals(res.code, 1);
    const output = res.err + "\n" + res.out;
    assertStringIncludes(output, ".waitsFor()");
    assertStringIncludes(output, ".dependsOn(");
    // No run is left resumable/stranded: any recorded run is terminal (failed).
    const store = new FileSystemStateStore(dir, defaultStateHost);
    for (const summary of await store.listRuns({})) {
      const got = await store.getRun(summary.id);
      const status = got === null ? "" : got.record.status;
      assertEquals(["suspended", "succeeded"].includes(status), false);
    }
  });
});

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

    // The failed target no longer carries the wait it gave up on — the timeout
    // fast-path settles the row by hand, without the writer that would
    // otherwise drop it, so `runs show` would print a failed target as parked
    // on a deadline in the past.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const gate = (await store.getRun(id))?.record.targets["gate"];
    assertEquals(gate?.status, "failed");
    assertEquals(gate?.waitingFor, undefined);
  });
});

Deno.test("a timeout settles the run's other parked gates too", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      // Two independent gates: only gateA's deadline has passed.
      gateA = target().waitsFor((s) => s.on(externalSignal("a")).timeout(0));
      gateB = target().waitsFor((s) => s.on(externalSignal("b")).timeout("1h"));
      all = target().dependsOn(this.gateA, this.gateB).executes(() => {});
    }
    const first = await runCli(B, ["all"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);

    const checked = await runCli(B, ["resume", "--check"]);
    assertEquals(checked.code, 1);
    assertEquals(await runStatus(dir, id), "failed");

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const targets = (await store.getRun(id))?.record.targets;
    assertEquals(targets?.["gateA"].status, "failed");
    // The run is terminal, so gateB is never resumed either. Failing only the
    // wait that expired would leave its sibling `waiting` forever, on a record
    // no sweep reaches again.
    assertEquals(targets?.["gateB"].status, "skipped");
    assertEquals(targets?.["gateB"].waitingFor, undefined);
  });
});

Deno.test("a cancel-run timeout still records the deadline it missed", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      // A zero-length deadline is already past by the time the sweep runs.
      approval = target().waitsFor((s) =>
        s.on(externalSignal("go")).timeout(0).onTimeout(() => "cancel-run")
      );
      deploy = target().dependsOn(this.approval).executes(() => {});
    }
    const first = await runCli(B, ["deploy"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);

    const checked = await runCli(B, ["resume", "--check"]);
    assertEquals(checked.code, 1);
    assertEquals(await runStatus(dir, id), "cancelled");

    // The `fail` disposition records the miss in the target's error. This
    // disposition cancels the run instead, and settles the gate through the
    // cancellation's sweep — which would otherwise leave a record that cannot
    // tell a missed deadline from an operator typing `zuke cancel`.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const gate = (await store.getRun(id))?.record.targets["approval"];
    assertEquals(gate?.status, "skipped");
    assertEquals(gate?.waitingFor, undefined);
    assertStringIncludes(gate?.error ?? "", 'wait "approval" timed out');

    const shown = await runCli(B, ["runs", "show", id]);
    assertStringIncludes(shown.out, 'wait "approval" timed out');
  });
});

Deno.test("cancelling a suspended run settles the gate it was parked on", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      gate = target().waitsFor((s) =>
        s.on(externalSignal("never")).timeout("1h")
      );
    }
    const first = await runCli(B, ["gate"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);
    assertEquals(await runStatus(dir, id), "suspended");

    const cancelled = await runCli(B, ["cancel", id]);
    assertEquals(cancelled.code, 0);
    assertEquals(await runStatus(dir, id), "cancelled");

    // A terminal run has no live waiter, so the gate is settled rather than
    // left claiming to wait for a signal nobody will send.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const gate = (await store.getRun(id))?.record.targets["gate"];
    assertEquals(gate?.status, "skipped");
    assertEquals(gate?.waitingFor, undefined);

    // Which is what `runs show` reports — it prints a `waiting` target's
    // trigger with no run-status guard, so a stale row is visible to an
    // operator, not merely to a record reader.
    const shown = await runCli(B, ["runs", "show", id]);
    assertEquals(shown.code, 0);
    assertStringIncludes(shown.out, "status:   cancelled");
    assertStringIncludes(shown.out, "gate  skipped");
  });
});

Deno.test("a re-suspend preserves the original timeout deadline", async () => {
  await withStateDir(async (dir) => {
    const ready = false; // never satisfied here: the gate only ever re-suspends
    class B extends Build {
      gate = target().waitsFor((s) =>
        s.on(resumeWhen(() => ready)).timeout("1h")
      );
    }
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const deadlineOf = async (id: string): Promise<string | undefined> =>
      (await store.getRun(id))?.record.targets["gate"].waitingFor?.deadline;

    const first = await runCli(B, ["gate"]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);
    const d1 = await deadlineOf(id);
    assertEquals(typeof d1, "string");

    // A `resume --check` while the predicate is still false re-suspends the gate.
    // The recorded deadline must stay put — recomputing `now + 1h` on every check
    // would push it forward forever, so the timeout could never fire.
    const again = await runCli(B, ["resume", "--check"]);
    assertEquals(again.code, 0);
    assertEquals(await runStatus(dir, id), "suspended");
    assertEquals(await deadlineOf(id), d1); // preserved, not moved
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

Deno.test("a resume that overrides a parameter records it in the audit trail", async () => {
  await withStateDir(async (dir) => {
    const deployed: string[] = [];
    class B extends Build {
      env = parameter("environment");
      token = parameter("deploy token").secret();
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      ship = target().dependsOn(this.gate).executes(() =>
        void deployed.push(this.env.value ?? "?")
      );
    }
    const first = await runCli(B, [
      "ship",
      "--env",
      "sit",
      "--token",
      "launch-secret",
    ]);
    assertEquals(first.code, 0);
    const id = await onlyRunId(dir);

    const resumed = await runCli(B, [
      "resume",
      id,
      "--signal",
      "go",
      "--env",
      "production",
      "--token",
      "rotated-secret",
    ]);
    assertEquals(resumed.code, 0);
    assertEquals(deployed, ["production"]);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const record = (await store.getRun(id))?.record;

    // `params` keeps the launch's values: a cancellation resolves each
    // compensation from them, and the targets a compensation unwinds are the
    // ones that ran before the gate — on `sit`.
    assertEquals(record?.params, { env: "sit" });

    // The override is reported instead, naming the value and who supplied it.
    const event = record?.events.find((e) => e.tool === "resume");
    assertEquals(event?.args, { env: "production" });
    assertEquals(event?.outcome, "ok");

    // Neither secret reaches the record, on either pass.
    const raw = JSON.stringify(record);
    assertEquals(raw.includes("rotated-secret"), false);
    assertEquals(raw.includes("launch-secret"), false);

    // And a reader sees both halves: what the run launched with, and what the
    // resume changed. The audit line prints the detail, not the arguments.
    const shown = await runCli(B, ["runs", "show", id]);
    assertStringIncludes(shown.out, "env = sit");
    assertStringIncludes(shown.out, "env=production");
  });
});

Deno.test("a resume that overrides nothing records no event", async () => {
  await withStateDir(async (dir) => {
    class B extends Build {
      env = parameter("environment");
      gate = target().waitsFor((s) => s.on(externalSignal("go")));
      ship = target().dependsOn(this.gate).executes(() => {});
    }
    assertEquals((await runCli(B, ["ship", "--env", "sit"])).code, 0);
    const id = await onlyRunId(dir);

    // The env var supplies the same value the launch did, so nothing differs
    // and an ordinary resume leaves no audit noise behind.
    const prev = Deno.env.get("ENV");
    Deno.env.set("ENV", "sit");
    try {
      assertEquals((await runCli(B, ["resume", id, "--signal", "go"])).code, 0);
    } finally {
      if (prev === undefined) Deno.env.delete("ENV");
      else Deno.env.set("ENV", prev);
    }
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const record = (await store.getRun(id))?.record;
    assertEquals(record?.params, { env: "sit" });
    assertEquals(record?.events.some((e) => e.tool === "resume"), false);
  });
});

Deno.test("a cancellation unwinds on the values its targets actually ran on", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class B extends Build {
      env = parameter("environment");
      deploy = target()
        .executes(() => void log.push(`deploy ${this.env.value}`))
        .onCancel(() => this.rollback);
      rollback = target().executes(() =>
        void log.push(`rollback ${this.env.value}`)
      );
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on(externalSignal("go"))
      );
      ship = target().dependsOn(this.gate).executes(() => {});
    }
    assertEquals((await runCli(B, ["ship", "--env", "sit"])).code, 0);
    const id = await onlyRunId(dir);

    // The deploy happened before the gate, on `sit`. Writing the resumer's
    // values over `record.params` would make this rollback undo it against
    // `prod` — a compensation acting on an environment its target never
    // touched, which is worse than the misreport it would have fixed.
    // Resumed with a different value but no signal, so the gate re-suspends
    // and the run is still cancellable — the deploy/gate/cancel shape a
    // compensation exists for.
    await runCli(B, ["resume", id, "--env", "prod"]);
    assertEquals(await runStatus(dir, id), "suspended");
    await runCli(B, ["cancel", id]);
    assertEquals(log, ["deploy sit", "rollback sit"]);
  });
});
