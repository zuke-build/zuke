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

Deno.test("a finished run is refused — there is no plan left to act on", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    assertEquals(
      (await runCli(Pipeline, ["resume", id, "--signal", "go"])).code,
      0,
    );
    const refused = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "--outcome",
      "skipped",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "is succeeded");
    assertStringIncludes(refused.err, "no longer a plan");
  });
});

Deno.test("a target that already settled in a live run is refused", async () => {
  // The record is the account of what happened; rewriting a settled outcome
  // would make it untrue. `prepare` succeeds before the gate parks the run.
  class Staged extends Build {
    prepare = target().executes(() => void ran.push("prepare"));
    gate = target()
      .dependsOn(this.prepare)
      .waitsFor((s) => s.on(externalSignal("go")))
      .executes(() => {});
  }
  await withStateDir(async (dir) => {
    ran.length = 0;
    assertEquals((await runCli(Staged, ["gate", "--state"])).code, 0);
    const id = await onlyRunId(dir);
    const record = await recordOf(dir, id);
    assertEquals(record.status, "suspended");
    assertEquals(record.targets.prepare.status, "succeeded");

    const refused = await runCli(Staged, [
      "force",
      id,
      "prepare",
      "--outcome",
      "skipped",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "already succeeded");
    assertEquals((await recordOf(dir, id)).overrides, undefined);
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

// ---- Regressions from the adversarial review -------------------------------

Deno.test("a foreign build cannot force another build's run", async () => {
  // `unforceable()` is read from the build in *this* process, so acting on
  // another build's run would check the wrong safety declaration entirely — a
  // template shared across services would let one force what its owner forbade.
  await withStateDir(async (dir) => {
    const owner = { ZUKE_BUILD_ID: "org/service-b" };
    const stranger = { ZUKE_BUILD_ID: "org/service-a" };
    const withEnv = async <T>(
      vars: Record<string, string>,
      fn: () => Promise<T>,
    ) => {
      const prev = Object.entries(vars).map(([k]) =>
        [k, Deno.env.get(k)] as const
      );
      for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
      try {
        return await fn();
      } finally {
        for (const [k, v] of prev) {
          if (v === undefined) Deno.env.delete(k);
          else Deno.env.set(k, v);
        }
      }
    };

    const id = await withEnv(owner, async () => {
      ran.length = 0;
      assertEquals((await runCli(Pipeline, ["report", "--state"])).code, 0);
      return await onlyRunId(dir);
    });

    const refused = await withEnv(
      stranger,
      () =>
        runCli(Pipeline, [
          "force",
          id,
          "report", // unforceable on the owner's build
          "--outcome",
          "succeeded",
        ]),
    );
    assertEquals(refused.code, 1, refused.out);
    assertStringIncludes(refused.err, "org/service-b");
    assertEquals((await recordOf(dir, id)).overrides, undefined);
  });
});

Deno.test("a forced gate outranks its own expired deadline", async () => {
  // Forcing a gate someone is waiting on is the reason the verb exists. Timing
  // it out afterwards would run the onTimeout disposition — here a cancel —
  // against the decision the operator had already made.
  class Gated extends Build {
    approval = target()
      .waitsFor((s) =>
        s.on(externalSignal("go")).timeout("1ms").onTimeout(() => "cancel-run")
      )
      .executes(() => void ran.push("approval"));
    deploy = target().dependsOn(this.approval).executes(() =>
      void ran.push("deploy")
    );
  }
  await withStateDir(async (dir) => {
    ran.length = 0;
    assertEquals((await runCli(Gated, ["deploy", "--state"])).code, 0);
    const id = await onlyRunId(dir);
    assertEquals((await recordOf(dir, id)).status, "suspended");

    assertEquals(
      (await runCli(Gated, [
        "force",
        id,
        "approval",
        "--outcome",
        "succeeded",
        "--reason",
        "approved out of band",
      ])).code,
      0,
    );

    // The deadline has long passed, but the force wins.
    const resumed = await runCli(Gated, ["resume", id]);
    assertEquals(resumed.code, 0, resumed.err);
    const record = await recordOf(dir, id);
    assertEquals(record.status, "succeeded");
    assertEquals(record.targets.approval.status, "succeeded");
    assertEquals(ran.includes("deploy"), true, ran.join(","));
  });
});

Deno.test("a forced success is compensated even before the run reaches it", async () => {
  // The operator asserted the target's effects exist — that is the whole
  // difference from forcing `skipped` — so a cancel landing in between must
  // still unwind them, while the row is still pending.
  class WithRollback extends Build {
    rollback = target().executes(() => void ran.push("rollback"));
    gate = target()
      .waitsFor((s) => s.on(externalSignal("go")))
      .executes(() => {});
    deploy = target()
      .dependsOn(this.gate)
      .onCancel(() => this.rollback)
      .executes(() => void ran.push("deploy"));
  }
  await withStateDir(async (dir) => {
    ran.length = 0;
    assertEquals((await runCli(WithRollback, ["deploy", "--state"])).code, 0);
    const id = await onlyRunId(dir);

    assertEquals(
      (await runCli(WithRollback, [
        "force",
        id,
        "deploy",
        "--outcome",
        "succeeded",
        "--reason",
        "deployed by hand",
      ])).code,
      0,
    );
    // Still pending: the run has not resumed past the gate.
    assertEquals((await recordOf(dir, id)).targets.deploy.status, "pending");

    assertEquals((await runCli(WithRollback, ["cancel", id])).code, 0);
    assertEquals(ran.includes("rollback"), true, ran.join(","));
  });
});

Deno.test("forcing a target that declares an effect to succeeded is refused", async () => {
  // Settling without running would drop the effect rather than defer it —
  // nothing recorded as owed, and the run reporting success. The same refusal
  // the cache and service layers already make.
  class WithEffect extends Build {
    gate = target()
      .waitsFor((s) => s.on(externalSignal("go")))
      .executes(() => {});
    publish = target()
      .dependsOn(this.gate)
      .effect("post-check", () => void ran.push("post-check"))
      .executes(() => {});
  }
  await withStateDir(async (dir) => {
    ran.length = 0;
    assertEquals((await runCli(WithEffect, ["publish", "--state"])).code, 0);
    const id = await onlyRunId(dir);

    const refused = await runCli(WithEffect, [
      "force",
      id,
      "publish",
      "--outcome",
      "succeeded",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "post-check");
    assertStringIncludes(refused.err, "drop");
    assertEquals((await recordOf(dir, id)).overrides, undefined);

    // Skipping is still allowed: a skipped target's effects are not owed.
    assertEquals(
      (await runCli(WithEffect, [
        "force",
        id,
        "publish",
        "--outcome",
        "skipped",
      ])).code,
      0,
    );
  });
});

Deno.test("a run being cancelled is refused", async () => {
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const loaded = await store.getRun(id);
    if (loaded === null) throw new Error("no record");
    await store.putRun(
      { ...loaded.record, status: "cancelling" },
      loaded.version,
    );

    const refused = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "--outcome",
      "skipped",
    ]);
    assertEquals(refused.code, 1);
    assertStringIncludes(refused.err, "cancelling");
  });
});

Deno.test("a stray positional is an error, not a different command", async () => {
  // Without the guard the third argument fell through to the target slot, so
  // `zuke force <id> <target> oops` quietly ran the build instead of forcing.
  await withStateDir(async (dir) => {
    const id = await suspended(dir);
    const strayed = await runCli(Pipeline, [
      "force",
      id,
      "migrate",
      "oops",
      "--outcome",
      "skipped",
    ]);
    assertEquals(strayed.code, 1);
    assertStringIncludes(strayed.err, "oops");
    assertEquals((await recordOf(dir, id)).overrides, undefined);
  });
});
