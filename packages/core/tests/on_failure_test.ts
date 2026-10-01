// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `.onFailure(...)`: a target whose failure cancels the run
 * instead of merely failing it, unwinding the succeeded targets through the same
 * compensation walk a cancel takes.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { cancelsOnFailure, failureDisposition } from "../src/on_failure.ts";
import { messageOf } from "../src/internal.ts";
import { withTempStore } from "./_store.ts";

Deno.test("failureDisposition defaults to fail and resolves each declared form", () => {
  class B extends Build {
    plain = target().executes(() => {});
    explicit = target().onFailure(() => "fail").executes(() => {});
    cancel = target().onFailure(() => "cancel-run").executes(() => {});
    // A thunk, so it can name a target declared below this one.
    named = target().onFailure(() => this.rollback).executes(() => {});
    rollback = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertEquals(failureDisposition(b.plain), "fail");
  assertEquals(failureDisposition(b.explicit), "fail");
  assertEquals(failureDisposition(b.cancel), "cancel-run");
  assertEquals(failureDisposition(b.named) === b.rollback, true);
  assertEquals(cancelsOnFailure(b.plain), false);
  assertEquals(cancelsOnFailure(b.explicit), false);
  assertEquals(cancelsOnFailure(b.cancel), true);
  assertEquals(cancelsOnFailure(b.named), true);
});

Deno.test("without .onFailure a failure fails the run and undoes nothing", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => void undone.push("rollback"));
      verify = target().dependsOn(this.deploy).executes(() => {
        throw new Error("unhealthy");
      });
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.verify, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertEquals(result.cancelled, undefined);
    assertEquals(undone, []);
    const record = result.runId ? await store.getRun(result.runId) : null;
    assertEquals(record?.record.status, "failed");
  });
});

Deno.test(".onFailure cancel-run rolls back every succeeded target, in reverse", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class B extends Build {
      stage = target()
        .executes((ctx) => ctx.state.set({ revision: "api-00042" }))
        .onCancel(() => this.unstage);
      expose = target().dependsOn(this.stage).executes(() => {})
        .onCancel(() => this.withdraw);
      analyze = target()
        .dependsOn(this.expose)
        .onFailure(() => "cancel-run")
        .executes(() => {
          throw new Error("5xx ratio 2.3% > 1%");
        });
      unstage = target().executes((ctx) =>
        void undone.push(`unstage:${ctx.state.get().revision}`)
      );
      withdraw = target().executes(() => void undone.push("withdraw"));
    }
    const b = new B();
    discoverTargets(b);
    const lines: string[] = [];
    const result = await execute(b, b.analyze, {
      stateStore: store,
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });

    assertEquals(result.ok, false);
    assertEquals(result.cancelled, true);
    // The failure that asked for the cancellation stays the run's error.
    assertEquals(messageOf(result.error), "5xx ratio 2.3% > 1%");
    // Later work unwound before the work it was built on.
    assertEquals(undone, ["withdraw", "unstage:api-00042"]);
    assertStringIncludes(lines.join("\n"), "analyze failed and its");

    const loaded = result.runId ? await store.getRun(result.runId) : null;
    assertEquals(loaded?.record.status, "cancelled");
    // The failed row still says why, so the record explains the rollback.
    assertEquals(loaded?.record.targets.analyze.status, "failed");
    assertEquals(
      loaded?.record.events.some((e) => e.tool === "cancel"),
      true,
    );
  });
});

Deno.test(".onFailure naming a target runs it first, with the failed target's state", async () => {
  await withTempStore(async (store) => {
    const order: string[] = [];
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.undeploy);
      verify = target()
        .dependsOn(this.deploy)
        .onFailure(() => this.diagnose)
        .executes(async (ctx) => {
          await ctx.state.set({ probe: "health" });
          throw new Error("probe failed");
        });
      undeploy = target().executes(() => void order.push("undeploy"));
      diagnose = target().executes((ctx) =>
        void order.push(`diagnose:${ctx.state.get().probe}`)
      );
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.verify, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.cancelled, true);
    // The named compensation runs before the reverse walk, reading verify's meta.
    assertEquals(order, ["diagnose:health", "undeploy"]);
  });
});

Deno.test(".onFailure acts on the final failure, after retries are exhausted", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let attempts = 0;
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => void undone.push("rollback"));
      flaky = target()
        .dependsOn(this.deploy)
        .retry(1)
        .onFailure(() => "cancel-run")
        .executes(() => {
          attempts++;
          if (attempts === 1) throw new Error("first attempt");
        });
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.flaky, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, true);
    assertEquals(attempts, 2);
    assertEquals(undone, []);
  });
});

Deno.test("a failure during an existing cancellation does not re-cancel or claim the error", async () => {
  // The target fails *because* the run was cancelled. That failure is a
  // symptom, so it must not become the run's error, and the walk runs once.
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => void undone.push("rollback"));
      wait = target()
        .dependsOn(this.deploy)
        .onFailure(() => this.rollback)
        .executes((ctx) =>
          new Promise<void>((_resolve, reject) => {
            ctx.signal.addEventListener(
              "abort",
              () => reject(new Error("interrupted")),
              { once: true },
            );
            started();
          })
        );
    }
    const b = new B();
    discoverTargets(b);
    const running = execute(b, b.wait, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    const result = await running;
    assertEquals(result.cancelled, true);
    assertEquals(result.error, undefined);
    // Only deploy's own compensation: the failure's named one was not added.
    assertEquals(undone, ["rollback"]);
  });
});

Deno.test("a cancelling failure stops an in-flight parallel sibling", async () => {
  await withTempStore(async (store) => {
    let siblingStopped = false;
    let siblingStarted: () => void = () => {};
    const siblingReady = new Promise<void>((r) => (siblingStarted = r));
    class B extends Build {
      long = target().executes((ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            siblingStopped = true;
            resolve();
          }, { once: true });
          siblingStarted();
        })
      );
      check = target()
        .onFailure(() => "cancel-run")
        .executes(async () => {
          await siblingReady;
          throw new Error("bad");
        });
      all = target().dependsOn(this.long, this.check).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      parallel: true,
    });
    assertEquals(result.cancelled, true);
    assertEquals(siblingStopped, true);
    assertEquals(messageOf(result.error), "bad");
  });
});

Deno.test(".onFailure that cancels is refused when state is disabled", async () => {
  let ran = false;
  class B extends Build {
    check = target()
      .onFailure(() => "cancel-run")
      .executes(() => void (ran = true));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.check, {
    silent: true,
    stateStore: false,
  });
  assertEquals(result.ok, false);
  assertEquals(ran, false);
  assertStringIncludes(messageOf(result.error), "needs a state store");
});

Deno.test("an explicit .onFailure fail does not require a state store", async () => {
  class B extends Build {
    check = target().onFailure(() => "fail").executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.check, {
    silent: true,
    stateStore: false,
  });
  assertEquals(result.ok, true);
});

Deno.test("a fan-out stage that declares .onFailure fails the fan-out with guidance", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      batch = target().forEach(
        () => ["a"],
        () => ({
          check: target().onFailure(() => "cancel-run").executes(() => {}),
        }),
      );
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.batch, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    assertStringIncludes(
      messageOf(result.error),
      'stage "check" uses .onFailure()',
    );
  });
});

Deno.test("a fan-out target's .onFailure cancels the run when an item fails", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class B extends Build {
      batch = target()
        .onFailure(() => "cancel-run")
        .forEach(
          () => ["good", "bad"],
          (item) => ({
            deploy: target()
              .executes(() => {
                if (item === "bad") throw new Error(`${item} failed`);
              })
              .onCancel(() =>
                target().executes(() => void undone.push(`undo:${item}`))
              ),
          }),
          (s) => s.concurrency(1).continueOnItemFailure(),
        );
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.batch, {
      silent: true,
      stateStore: store,
    });
    // The failing *item* alone does not cancel (it is not in the run's plan);
    // the fan-out target failing does, and the good item is rolled back.
    assertEquals(result.cancelled, true);
    assertEquals(undone, ["undo:good"]);
  });
});

Deno.test("a dry run never cancels on a failure, since it has nothing to roll back", async () => {
  class B extends Build {
    check = target()
      .dryRunnable()
      .onFailure(() => "cancel-run")
      .executes(() => {
        throw new Error("fails even in a dry run");
      });
  }
  const b = new B();
  discoverTargets(b);
  const lines: string[] = [];
  const result = await execute(b, b.check, {
    dryRun: true,
    reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
  });
  assertEquals(result.ok, false);
  assertEquals(result.cancelled, undefined);
  assertEquals(lines.some((l) => l.includes("rolling back")), false);
});
