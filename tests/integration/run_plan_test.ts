// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for `ctx.plan()` — the resolved run shape, read through a
 * real build driven by the CLI.
 *
 * The unit tests cover the view itself; these prove the engine hands the same
 * plan to every place that can read one, including the two different moments a
 * condition is evaluated.
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

Deno.test("a body reads the run's planned targets and their dependencies", async () => {
  const seen: string[] = [];
  class B extends Build {
    lint = target().executes(() => {});
    unit = target().dependsOn(this.lint).executes(() => {});
    report = target().dependsOn(this.unit).executes((ctx) => {
      seen.push(`targets=${[...ctx.plan().targets].sort().join(",")}`);
      seen.push(`deps(unit)=${ctx.plan().dependenciesOf("unit").join(",")}`);
      seen.push(`includes(lint)=${ctx.plan().includes("lint")}`);
    });
  }
  const { code, err } = await runCli(B, ["report"]);
  assertEquals(code, 0, err);
  assertEquals(seen, [
    "targets=lint,report,unit",
    "deps(unit)=lint",
    "includes(lint)=true",
  ]);
});

Deno.test("the plan covers only what this run's root reaches", async () => {
  // The question a body actually asks — "was `deploy` asked for?" — has to be
  // answered for *this* run, not for everything the build could do.
  const seen: string[] = [];
  class B extends Build {
    build = target().executes((ctx) => {
      seen.push(`deploy=${ctx.plan().includes("deploy")}`);
    });
    deploy = target().dependsOn(this.build).executes(() => {});
  }

  const first = await runCli(B, ["build"]);
  assertEquals(first.code, 0, first.err);
  const second = await runCli(B, ["deploy"]);
  assertEquals(second.code, 0, second.err);

  // Same body, same build, two runs — and the answer differs, because the plan
  // describes the run rather than the class.
  assertEquals(seen, ["deploy=false", "deploy=true"]);
});

Deno.test("a condition reads the same plan its target's body does", async () => {
  const fromCondition: string[] = [];
  const fromBody: string[] = [];
  class B extends Build {
    setup = target().executes(() => {});
    gated = target()
      .dependsOn(this.setup)
      .onlyWhen((ctx) => {
        fromCondition.push([...ctx.plan().targets].sort().join(","));
        return ctx.plan().includes("setup");
      })
      .executes((ctx) => {
        fromBody.push([...ctx.plan().targets].sort().join(","));
      });
  }
  const { code, err } = await runCli(B, ["gated"]);
  assertEquals(code, 0, err);
  assertEquals(fromCondition, ["gated,setup"]);
  assertEquals(fromBody, ["gated,setup"]);
});

Deno.test("a skip-dependencies condition sees one plan at both evaluations", async () => {
  // The reason the plan reports graph facts and not "will this run": a
  // `whenSkipped("skip-dependencies")` condition is evaluated once up front to
  // decide what the run prunes, and again when the scheduler reaches the
  // target. A view of what *will* run would answer differently each time — and
  // at the first call it would be circular, since this condition is one of the
  // things deciding it.
  const seen: string[] = [];
  class B extends Build {
    helper = target().executes(() => {});
    gated = target()
      .dependsOn(this.helper)
      .whenSkipped("skip-dependencies")
      .onlyWhen((ctx) => {
        seen.push([...ctx.plan().targets].sort().join(","));
        return true;
      })
      .executes(() => {});
  }
  const { code, err } = await runCli(B, ["gated"]);
  assertEquals(code, 0, err);
  // Evaluated twice, and the two calls agree.
  assertEquals(seen.length, 2);
  assertEquals(seen[0], "gated,helper");
  assertEquals(seen[1], "gated,helper");
});

Deno.test("a zero-argument condition still compiles and runs", async () => {
  // The compatibility promise: widening the callback's parameter list must not
  // disturb the conditions every existing build already declares.
  let ran = false;
  class B extends Build {
    only = target()
      .onlyWhen(() => true)
      .executes(() => {
        ran = true;
      });
  }
  const { code, err } = await runCli(B, ["only"]);
  assertEquals(code, 0, err);
  assertEquals(ran, true);
});

Deno.test("a fan-out's sub-targets are not in the plan, though they have outcomes", async () => {
  // The one place the plan reports LESS than the outcomes do. `.forEach()`
  // expands while the run executes, after the graph is planned — so a
  // sub-target has a summary row and an outcome, but was never in the plan.
  // Documented in docs/run-context.md; pinned here so it cannot drift into a
  // claim the code does not keep.
  const seen: string[] = [];
  class B extends Build {
    fan = target().forEach(
      () => ["us"],
      () => ({ prep: target().executes(() => {}) }),
    );
    top = target().dependsOn(this.fan).executes((ctx) => {
      const sub = "fan[us].prep";
      seen.push(`outcome=${ctx.outcomeOf(sub)?.status}`);
      seen.push(`includes=${ctx.plan().includes(sub)}`);
      seen.push(`targets=${[...ctx.plan().targets].sort().join(",")}`);
    });
  }
  const { code, err } = await runCli(B, ["top"]);
  assertEquals(code, 0, err);
  assertEquals(seen, [
    // It ran, and the record knows it...
    "outcome=succeeded",
    // ...but the plan never had it, and says so rather than guessing.
    "includes=false",
    // Only the fan-out target that produced it is planned.
    "targets=fan,top",
  ]);
});

Deno.test("a compensation run by `zuke cancel` reads the run's plan", async () => {
  // The wiring a unit test cannot reach: `cancelRun` re-plans the graph in the
  // cancelling process and hands that plan to the walk. Driving
  // `runCompensations` directly with a plan the test built proves nothing about
  // it — replacing cancel.ts's plan with an empty one left that green.
  await withStateDir(async () => {
    const log: string[] = [];
    class CD extends Build {
      rollback = target().executes((ctx) => {
        log.push(`plan:${[...ctx.plan().targets].sort().join(",")}`);
        log.push(`includes(deploy):${ctx.plan().includes("deploy")}`);
      });
      deploy = target()
        .executes((ctx) => ctx.state.set({ slot: "sit-7" }))
        .onCancel(() => this.rollback);
      gate = target()
        .dependsOn(this.deploy)
        .waitsFor((s) => s.on(externalSignal("approved")));
      promote = target().dependsOn(this.gate).executes(() => {});
    }

    const first = await runCli(CD, ["promote"]);
    assertEquals(first.code, 0, first.err);
    const store = new FileSystemStateStore(
      Deno.env.get("ZUKE_STATE_DIR") ?? "",
      defaultStateHost,
    );
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);

    const cancelled = await runCli(CD, [
      "cancel",
      runs[0].id,
      "--actor",
      "ops",
    ]);
    assertEquals(cancelled.code, 0, cancelled.err);
    // The compensation saw the real graph, not an empty plan.
    assertEquals(log, ["plan:deploy,gate,promote", "includes(deploy):true"]);
  });
});

Deno.test("a compensation run by an in-process cancel reads the run's plan", async () => {
  // The other cancel path: Ctrl-C / an aborted signal settles the run in the
  // executing process, through `settleCancelledRun` rather than `cancelRun`.
  // It is wired separately, so it needs its own proof.
  await withStateDir(async () => {
    const log: string[] = [];
    const controller = new AbortController();
    class B extends Build {
      rollback = target().executes((ctx) => {
        log.push(`plan:${[...ctx.plan().targets].sort().join(",")}`);
      });
      deploy = target()
        .executes(() => {
          controller.abort();
        })
        .onCancel(() => this.rollback);
      promote = target().dependsOn(this.deploy).executes(() => {});
    }
    const { code } = await runCli(B, ["promote"], {
      signal: controller.signal,
    });
    assertEquals(code, 1);
    assertEquals(log, ["plan:deploy,promote"]);
  });
});
