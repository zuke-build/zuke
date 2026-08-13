// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for `ctx.outcomeOf(...)` / `ctx.outcomes()` — a target
 * reading what the rest of the run did.
 *
 * Driven through the real CLI entry point, because what is under test is what
 * the scheduler has established by the time a body runs, which no unit of the
 * scheduler can answer on its own.
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
  type TargetOutcomeView,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The id of the (single) run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const runs = await store.listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].id;
}

Deno.test("a target reads its dependencies' outcomes, including a skipped one", async () => {
  const seen = new Map<string, TargetOutcomeView | undefined>();

  class Ci extends Build {
    unit = target().executes(() => {});
    optional = target().onlyWhen(() => false).executes(() => {});
    gate = target()
      .dependsOn(this.unit, this.optional)
      .executes((ctx) => {
        for (const name of ["unit", "optional", "gate", "nonexistent"]) {
          seen.set(name, ctx.outcomeOf(name));
        }
      });
  }

  const { code } = await runCli(Ci, ["gate"]);
  assertEquals(code, 0);
  assertEquals(seen.get("unit")?.status, "succeeded");
  assertEquals(seen.get("optional")?.status, "skipped");
  // A target has no outcome while it is the one running, and a name that is not
  // in the run has none either — neither is invented.
  assertEquals(seen.get("gate"), undefined);
  assertEquals(seen.get("nonexistent"), undefined);
});

Deno.test("a dependency's outcome is current, not one state write behind", async () => {
  // The reason outcomes do not come from the run record: every
  // `markTargetSettled` is fire-and-forget through the writer's serialized
  // chain, so a record read taken right after a target settles still says
  // `running`. A body reading that would branch on a target that has in fact
  // finished — and for an aggregating gate, "not failed yet" reads as green.
  let status: string | undefined;

  class Ci extends Build {
    unit = target().executes(() => {});
    gate = target().dependsOn(this.unit).executes((ctx) => {
      status = ctx.outcomeOf("unit")?.status;
    });
  }

  await withStateDir(async () => {
    const { code } = await runCli(Ci, ["gate", "--state"]);
    assertEquals(code, 0);
    assertEquals(status, "succeeded");
  });
});

Deno.test("outcomes carry across a resume, for targets this process never ran", async () => {
  // `first` succeeded in the process that suspended. The process that resumes
  // never executes it, and must still report what it did — which only the
  // durable record knows.
  let afterResume: TargetOutcomeView | undefined;

  class Cd extends Build {
    first = target().executes(() => {});
    hold = target().dependsOn(this.first).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    last = target().dependsOn(this.hold).executes((ctx) => {
      afterResume = ctx.outcomeOf("first");
    });
  }

  await withStateDir(async (dir) => {
    const started = await runCli(Cd, ["last"]);
    assertEquals(started.code, 0); // a suspend is exit 0, not a failure
    assertEquals(afterResume, undefined); // `last` has not run yet
    const id = await onlyRunId(dir);

    const resumed = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    assertEquals(afterResume?.status, "succeeded");
    // The timestamps come from the record, so they survive the process too.
    assertEquals(typeof afterResume?.endedAt, "string");
  });
});

Deno.test("outcomes work without a state store", async () => {
  // Nothing about reading the run's own results requires durability, so a plain
  // run answers the same as a state-backed one.
  const seen: string[] = [];

  class Plain extends Build {
    one = target().executes(() => {});
    two = target().dependsOn(this.one).executes((ctx) => {
      const outcome = ctx.outcomeOf("one");
      seen.push(outcome === undefined ? "missing" : outcome.status);
    });
  }

  const { code } = await runCli(Plain, ["two"]);
  assertEquals(code, 0);
  assertEquals(seen, ["succeeded"]);
});

Deno.test("outcomes() lists what has settled and nothing that has not", async () => {
  let listed: string[] = [];

  class Ci extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
    gate = target().dependsOn(this.b).executes((ctx) => {
      listed = [...ctx.outcomes()].map(([name, o]) => `${name}=${o.status}`)
        .sort();
    });
    after = target().dependsOn(this.gate).executes(() => {});
  }

  await runCli(Ci, ["after"]);
  // `gate` is running and `after` has not started: neither has an outcome.
  assertEquals(listed, ["a=succeeded", "b=succeeded"]);
});
