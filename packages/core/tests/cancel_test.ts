// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { parameter } from "../src/params.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import {
  cancelRun,
  compensationEvents,
  runCompensations,
} from "../src/cancel.ts";
import { resumeRun } from "../src/resume.ts";
import type { OrderingEdge } from "../src/graph.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import {
  defaultStateHost,
  type PutResult,
  type StateStore,
} from "../src/state/store.ts";
import { lockKey } from "../src/state/lock.ts";
import type { RunRecord } from "../src/state/types.ts";
import type { Reporter } from "../src/executor.ts";
import { externalSignal } from "../src/wait.ts";
import { withTemp } from "./_temp.ts";
import { runRecord } from "./_fakes.ts";
import { withTempStore } from "./_store.ts";

/** A run record scaffold for driving {@link runCompensations} directly. */
function craftRecord(
  rootTarget: string,
  targets: RunRecord["targets"],
): RunRecord {
  return runRecord({
    id: "run",
    build: "B",
    rootTarget,
    status: "cancelling",
    actor: "ops",
    createdAt: "t",
    updatedAt: "t",
    graph: [],
    targets,
  });
}

/** A reporter that captures error lines (for asserting cancel diagnostics). */
function capturingReporter(): { reporter: Reporter; errors: string[] } {
  const errors: string[] = [];
  return { reporter: { info: () => {}, error: (l) => errors.push(l) }, errors };
}

Deno.test("cancelRun runs a suspended run's compensations in reverse order", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let rolledBackSlot: unknown;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target()
          .executes((ctx) => ctx.state.set({ slot: "sit-7" }))
          .onCancel(() => this.rollbackDeploy);
        rollbackDeploy = target().executes((ctx) => {
          undone.push("deploy");
          rolledBackSlot = ctx.state.get().slot;
        });
        migrate = target()
          .dependsOn(this.deploy)
          .executes(() => {})
          .onCancel(() => this.rollbackMigrate);
        rollbackMigrate = target().executes(() => void undone.push("migrate"));
        gate = target()
          .dependsOn(this.migrate)
          .waitsFor((s) => s.on(externalSignal("approved")));
        promote = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };

    // Process A: deploy + migrate succeed, then the run suspends at the gate.
    const a = makeBuild();
    const resA = await execute(a, a.promote, {
      silent: true,
      stateStore: store,
    });
    assertEquals(resA.suspended, true);
    const runId = (await store.listRuns({}))[0].id;

    // A fresh process cancels it.
    const result = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.noop, false);
    assertEquals(result.status, "cancelled");
    // Reverse topological: migrate is unwound before deploy.
    assertEquals(undone, ["migrate", "deploy"]);
    // The compensation read the original target's persisted metadata.
    assertEquals(rolledBackSlot, "sit-7");

    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "cancelled");
    // The cancellation is recorded in the audit trail, attributed to the canceller.
    const event = loaded?.record.events.find((e) => e.tool === "cancel");
    assertEquals(event?.actor, "ops");
    assertEquals(event?.outcome, "ok");
  });
});

Deno.test("cancelRun is a friendly no-op on an already-finished run", async () => {
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        go = target().executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    await execute(makeBuild(), makeBuild().go, {
      silent: true,
      stateStore: store,
    });
    // The above ran a throwaway build; run a real one to get a persisted record.
    const b = makeBuild();
    await execute(b, b.go, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.noop, true);
    assertEquals(result.status, "succeeded");
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "succeeded"); // untouched
  });
});

Deno.test("cancelRun throws on a missing run", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      go = target().executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    await assertRejects(
      () => cancelRun(b, { runId: "nope", stateStore: store, silent: true }),
      Error,
      "no run",
    );
  });
});

Deno.test("a failing compensation is recorded but the walk continues", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        a = target().executes(() => {}).onCancel(() => this.rollbackA);
        rollbackA = target().executes(() => {
          throw new Error("boom");
        });
        b = target()
          .dependsOn(this.a)
          .executes(() => {})
          .onCancel(() => this.rollbackB);
        rollbackB = target().executes(() => void undone.push("b"));
        gate = target()
          .dependsOn(this.b)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].forTarget, "a");
    // rollbackB ran despite rollbackA throwing (reverse order: b before a).
    assertEquals(undone, ["b"]);
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "cancelled");
    const event = loaded?.record.events.find((e) => e.tool === "cancel");
    assertEquals(event?.outcome, "error");
  });
});

Deno.test("an in-process cancellation (options.signal) runs compensations", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    class B extends Build {
      deploy = target()
        .executes((ctx) => ctx.state.set({ slot: "sit-1" }))
        .onCancel(() => this.rollback);
      rollback = target().executes((ctx) =>
        void undone.push(`rollback:${ctx.state.get().slot}`)
      );
      hang = target()
        .dependsOn(this.deploy)
        .executes((ctx) =>
          new Promise<void>((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
            started();
          })
        );
    }
    const b = new B();
    discoverTargets(b);

    const runPromise = execute(b, b.hang, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    const result = await runPromise;

    assertEquals(result.ok, false);
    assertEquals(result.cancelled, true);
    // deploy succeeded → its compensation ran, reading its persisted slot.
    assertEquals(undone, ["rollback:sit-1"]);
    const loaded = result.runId ? await store.getRun(result.runId) : null;
    assertEquals(loaded?.record.status, "cancelled");
  });
});

Deno.test("a live run observes an external cancel on its next write and stops", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let abortedInside = false;
    class B extends Build {
      deploy = target()
        .executes((ctx) => ctx.state.set({ slot: "sit-9" }))
        .onCancel(() => this.rollback);
      rollback = target().executes(() => void undone.push("deploy"));
      work = target().dependsOn(this.deploy).executes(async (ctx) => {
        started();
        await released; // pause until the external cancel has landed
        // This write finds the record moved to `cancelling` → observe → abort.
        await ctx.state.set({ step: 1 });
        abortedInside = ctx.signal.aborted;
      });
    }
    const b = new B();
    discoverTargets(b);

    const runPromise = execute(b, b.work, { silent: true, stateStore: store });
    await ready;
    const runId = (await store.listRuns({}))[0].id;

    // Another process cancels: move the record to `cancelling`. Retry until it
    // lands (the owning writer may still be flushing `work`'s markTargetRunning).
    await forceCancelling(store, runId);
    release();
    const result = await runPromise;

    assertEquals(result.cancelled, true);
    assertEquals(abortedInside, true); // the running body saw its signal abort
    // The owning process did NOT run compensations (the canceller owns them)…
    assertEquals(undone, []);
    // …and left the record `cancelling` for the canceller to settle.
    const after = await store.getRun(runId);
    assertEquals(after?.record.status, "cancelling");
    // The conflicting write was re-applied onto the cancelling record (not
    // dropped), so a target update racing the cancel isn't lost to the canceller.
    assertEquals(after?.record.targets.work?.meta.step, 1);
  });
});

Deno.test("cancelRun throws when state is disabled", async () => {
  class B extends Build {
    go = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  await assertRejects(
    () => cancelRun(b, { runId: "x", stateStore: false, silent: true }),
    Error,
    "no state store",
  );
});

Deno.test("cancelRun recovers a run stranded mid-cancellation, without re-compensating", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => void undone.push("deploy"));
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    // A crashed canceller left it `cancelling`. A re-cancel must not strand it —
    // it finalizes to cancelled without re-running compensations.
    const loaded = await store.getRun(id);
    if (loaded === null) throw new Error("run vanished");
    await store.putRun(
      { ...loaded.record, status: "cancelling" },
      loaded.version,
    );

    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.noop, false);
    assertEquals(result.status, "cancelled");
    assertEquals(undone, []); // compensations are NOT re-run on recovery
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("cancelRun cancels a run whose root target no longer exists", async () => {
  await withTempStore(async (store) => {
    class Old extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("x")));
      deploy = target().dependsOn(this.gate).executes(() => {});
    }
    const a = new Old();
    discoverTargets(a);
    await execute(a, a.deploy, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    // A build that no longer declares the recorded root target.
    class New extends Build {
      other = target().executes(() => {});
    }
    const b = new New();
    discoverTargets(b);
    const result = await cancelRun(b, {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.compensated, []); // no graph → no compensations
  });
});

Deno.test("a compensation resolving to undefined or lacking a body is skipped", async () => {
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        // @ts-expect-error deliberately return undefined to exercise the runtime skip
        a = target().executes(() => {}).onCancel(() => undefined);
        // A compensation target with no .executes() body.
        noBody = target();
        b = target()
          .dependsOn(this.a)
          .executes(() => {})
          .onCancel(() => this.noBody);
        gate = target()
          .dependsOn(this.b)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.compensated, []); // undefined + body-less → both skipped
    assertEquals(result.failures, []);
  });
});

Deno.test("a compensation can write to its in-memory state handle", async () => {
  await withTempStore(async (store) => {
    let observed: unknown;
    const makeBuild = () => {
      class B extends Build {
        deploy = target()
          .executes((ctx) => ctx.state.set({ slot: "s1" }))
          .onCancel(() => this.rollback);
        rollback = target().executes(async (ctx) => {
          await ctx.state.set({ note: "cleaned" }); // exercises the in-memory set
          observed = ctx.state.get().note;
        });
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(observed, "cleaned");
  });
});

Deno.test("a timed-out wait with onTimeout cancel-run cancels the run", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => void undone.push("deploy"));
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) =>
            s.on(externalSignal("never")).timeout(0).onTimeout(() =>
              "cancel-run"
            )
          );
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    // Resuming past the deadline routes the timeout through cancellation.
    const result = await resumeRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, false);
    assertEquals(result.cancelled, true);
    assertEquals(undone, ["deploy"]); // deploy's compensation ran
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("a timed-out wait with a named onTimeout target runs it as a compensation", async () => {
  await withTempStore(async (store) => {
    const ran: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {});
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) =>
            s.on(externalSignal("never")).timeout(0).onTimeout(() =>
              this.cleanup
            )
          );
        cleanup = target().executes(() => void ran.push("cleanup"));
        done = target().dependsOn(this.gate).executes(() => {});
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.done, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    const result = await resumeRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.ok, false);
    assertEquals(ran, ["cleanup"]); // the named onTimeout target ran (resolveExtra)
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("a throwing .onCancel() thunk is recorded, not fatal", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        // A thunk that always throws (return type `never`, so still assignable).
        a = target().executes(() => {}).onCancel(() => {
          throw new Error("thunk boom");
        });
        b = target()
          .dependsOn(this.a)
          .executes(() => {})
          .onCancel(() => this.rollbackB);
        rollbackB = target().executes(() => void undone.push("b"));
        gate = target()
          .dependsOn(this.b)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    // The throwing thunk is recorded as a failure; the walk continues (rollbackB
    // ran) and the run still settles cancelled — never wedged.
    assertEquals(result.status, "cancelled");
    assertEquals(result.failures.some((f) => f.forTarget === "a"), true);
    assertEquals(undone, ["b"]);
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("a secret in a compensation failure message is redacted", async () => {
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        token = parameter("api token").secret();
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => {
          throw new Error(`cleanup failed using ${this.token.value}`);
        });
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const readEnv = (name: string) =>
      name === "TOKEN" ? "s3cr3t-value" : undefined;
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store, readEnv });
    const id = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
      readEnv,
    });
    const messages = result.failures.map((f) => f.error).join("\n");
    assertEquals(messages.includes("s3cr3t-value"), false); // masked
    assertEquals(result.failures.length, 1);
  });
});

Deno.test("an in-process cancellation records a cancel audit event", async () => {
  await withTempStore(async (store) => {
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => {});
      hang = target()
        .dependsOn(this.deploy)
        .executes((ctx) =>
          new Promise<void>((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
            started();
          })
        );
    }
    const b = new B();
    discoverTargets(b);
    const runPromise = execute(b, b.hang, {
      silent: true,
      stateStore: store,
      actor: "operator",
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    const result = await runPromise;
    assertEquals(result.cancelled, true);
    const loaded = result.runId ? await store.getRun(result.runId) : null;
    // Ctrl-C records the cancellation in the audit trail, like `zuke cancel`.
    const event = loaded?.record.events.find((e) => e.tool === "cancel");
    assertEquals(event?.actor, "operator");
  });
});

Deno.test("a hung compensation is bounded by its .timeout()", async () => {
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target()
          .timeout(20)
          .executes(() => new Promise<void>(() => {})); // never resolves
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;
    // The walk does not hang; the timed-out compensation is a recorded failure
    // and the run still settles cancelled.
    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].error.includes("timed out"), true);
  });
});

Deno.test("fan-out sub-target compensations run per item, in reverse, on cancel", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class CD extends Build {
        deployBatch = target().forEach(
          () => ["a", "b", "c"],
          (repo) => ({
            deploy: target()
              .executes((ctx) => ctx.state.set({ slot: `slot-${repo}` }))
              .onCancel(() =>
                target().executes((ctx) => {
                  undone.push(`${repo}:${ctx.state.get().slot}`);
                })
              ),
          }),
          (s) => s.continueOnItemFailure(),
        );
        gate = target()
          .dependsOn(this.deployBatch)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    const res = await execute(a, a.gate, { silent: true, stateStore: store });
    assertEquals(res.suspended, true);
    const runId = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.status, "cancelled");
    // Reverse item order; each read its own item-scoped persisted slot.
    assertEquals(undone, ["c:slot-c", "b:slot-b", "a:slot-a"]);

    const loaded = await store.getRun(runId);
    const events = (loaded?.record.events ?? []).filter(
      (e) => e.tool === "compensate",
    );
    assertEquals(events.length, 3);
    assertEquals(
      events.map((e) => e.args.target).sort(),
      [
        "deployBatch[a].deploy",
        "deployBatch[b].deploy",
        "deployBatch[c].deploy",
      ],
    );
    assertEquals(events.every((e) => e.outcome === "ok"), true);
  });
});

Deno.test("a throwing fan-out item compensation is recorded; the others still run", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class CD extends Build {
        deployBatch = target().forEach(
          () => ["a", "b", "c"],
          (repo) => ({
            deploy: target().executes(() => {}).onCancel(() =>
              target().executes(() => {
                if (repo === "a") throw new Error("boom-a");
                undone.push(repo);
              })
            ),
          }),
          (s) => s.continueOnItemFailure(),
        );
        gate = target()
          .dependsOn(this.deployBatch)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const runId = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId,
      stateStore: store,
      silent: true,
    });
    assertEquals(result.status, "cancelled"); // never wedged
    // c and b ran (reverse order) despite a throwing.
    assertEquals(undone, ["c", "b"]);
    assertEquals(
      result.failures.some((f) => f.forTarget === "deployBatch[a].deploy"),
      true,
    );
    const loaded = await store.getRun(runId);
    const errored = (loaded?.record.events ?? []).filter(
      (e) => e.tool === "compensate" && e.outcome === "error",
    );
    assertEquals(errored.length, 1);
    assertEquals(errored[0].args.target, "deployBatch[a].deploy");
  });
});

Deno.test("an in-flight (running) fan-out item is compensated; a stage with no onCancel is skipped", async () => {
  const undone: string[] = [];
  class CD extends Build {
    deployBatch = target().forEach(
      () => ["a", "b"],
      (repo) => ({
        deploy: target().executes(() => {}).onCancel(() =>
          target().executes(() => void undone.push(repo))
        ),
        // A second stage with no compensation — nothing to undo.
        verify: target().executes(() => {}),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  // "a" succeeded, "b" was still running when the cancel landed — both undo;
  // the verify stages have no onCancel, so they are skipped even when succeeded.
  const record = craftRecord("deployBatch", {
    "deployBatch[a].deploy": { status: "succeeded", meta: {} },
    "deployBatch[a].verify": { status: "succeeded", meta: {} },
    "deployBatch[b].deploy": { status: "running", meta: {} },
    "deployBatch[b].verify": { status: "pending", meta: {} },
  });
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
  });
  assertEquals(undone, ["b", "a"]); // reverse order, deploy stages only
  assertEquals(outcome.attempts.length, 2);
  assertEquals(outcome.attempts.every((a) => a.ok), true);
});

Deno.test("a pending fan-out item (never started) is not compensated", async () => {
  const undone: string[] = [];
  class CD extends Build {
    deployBatch = target().forEach(
      () => ["a", "b"],
      (repo) => ({
        deploy: target().executes(() => {}).onCancel(() =>
          target().executes(() => void undone.push(repo))
        ),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch[a].deploy": { status: "succeeded", meta: {} },
    "deployBatch[b].deploy": { status: "pending", meta: {} },
  });
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
  });
  assertEquals(undone, ["a"]); // b never ran → nothing to undo
  assertEquals(outcome.attempts.length, 1);
});

Deno.test("a non-deterministic forEach list reports an unmatched recorded item", async () => {
  class CD extends Build {
    deployBatch = target().forEach(
      () => ["a"], // cancel-time list no longer includes "z"
      (_repo) => ({
        deploy: target().executes(() => {}).onCancel(() =>
          target().executes(() => {})
        ),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch[z].deploy": { status: "succeeded", meta: {} },
    // An unmatched, non-compensable row (failed) is silently skipped — no warning.
    "deployBatch[gone].deploy": { status: "failed", meta: {} },
  });
  const { reporter, errors } = capturingReporter();
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter,
  });
  assertEquals(outcome.failures, []); // not a crash
  assertEquals(
    errors.some((e) =>
      e.includes("deployBatch[z].deploy") &&
      e.includes("no matching re-materialised item")
    ),
    true,
  );
  // The non-compensable unmatched row does not warn.
  assertEquals(errors.some((e) => e.includes("deployBatch[gone]")), false);
});

Deno.test("a forEach item list that throws at cancel is recorded, not fatal", async () => {
  class CD extends Build {
    deployBatch = target().forEach(
      () => {
        throw new Error("list boom");
      },
      (_repo) => ({ deploy: target().executes(() => {}) }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch[a].deploy": { status: "succeeded", meta: {} },
  });
  const { reporter } = capturingReporter();
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter,
  });
  assertEquals(
    outcome.failures.some((f) => f.error.includes("list boom")),
    true,
  );
  assertEquals(outcome.failures[0].forTarget, "deployBatch");
});

Deno.test("an item .onCancel() thunk that throws or returns undefined is skipped", async () => {
  const undone: string[] = [];
  class CD extends Build {
    deployBatch = target().forEach(
      () => ["boom", "undef", "ok"],
      (repo) => ({
        // @ts-expect-error the "undef" branch returns undefined to exercise the skip
        deploy: target().executes(() => {}).onCancel(() => {
          if (repo === "boom") throw new Error("thunk boom");
          if (repo === "undef") return undefined;
          return target().executes(() => void undone.push(repo));
        }),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch[boom].deploy": { status: "succeeded", meta: {} },
    "deployBatch[undef].deploy": { status: "succeeded", meta: {} },
    "deployBatch[ok].deploy": { status: "succeeded", meta: {} },
  });
  const { reporter } = capturingReporter();
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter,
  });
  assertEquals(undone, ["ok"]); // only the valid item compensated
  // The throwing thunk is a recorded failure; undefined is silently skipped.
  assertEquals(
    outcome.failures.some((f) => f.forTarget === "deployBatch[boom].deploy"),
    true,
  );
  // The thrown thunk is also an attempt (ok:false), so it yields a per-target
  // `compensate` event matching the summary's failed count.
  assertEquals(
    outcome.attempts.some((a) =>
      a.forTarget === "deployBatch[boom].deploy" && !a.ok
    ),
    true,
  );
  const events = compensationEvents(outcome.attempts, "ops", "t");
  assertEquals(
    events.some((e) =>
      e.args.target === "deployBatch[boom].deploy" && e.outcome === "error"
    ),
    true,
  );
});

Deno.test("cancel runs a nested fan-out item's onCancel without false-warning", async () => {
  const undone: string[] = [];
  class CD extends Build {
    // deployBatch fans out over ["a"]; each item's `inner` stage is itself a
    // fan-out over ["g1"], whose `push` grandchild declares its own onCancel.
    deployBatch = target().forEach(
      () => ["a"],
      (repo) => ({
        inner: target().forEach(
          () => ["g1"],
          (g) => ({
            push: target().executes(() => {}).onCancel(() =>
              target().executes(() => void undone.push(`${repo}/${g}`))
            ),
          }),
        ),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch": { status: "succeeded", meta: {} },
    "deployBatch[a].inner": { status: "succeeded", meta: {} },
    "deployBatch[a].inner[g1].push": { status: "succeeded", meta: {} },
  });
  const { reporter, errors } = capturingReporter();
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter,
  });
  assertEquals(undone, ["a/g1"]); // the grandchild's compensation ran
  assertEquals(outcome.attempts.length, 1);
  // Every descendant row is recognised, so no spurious "no matching" warning.
  assertEquals(
    errors.some((e) => e.includes("no matching re-materialised")),
    false,
  );
});

Deno.test("a declared target reused as a fan-out stage keeps its own name at cancel", async () => {
  const undone: string[] = [];
  class CD extends Build {
    // `seed` is both a target of its own and the factory's stage builder, which a
    // build is free to do. Re-materialising the fan-out must not rename it: the
    // walk reaches `seed` afterwards and looks its compensation decision up by
    // name.
    seed = target().executes(() => {}).onCancel(() =>
      target().executes(() => void undone.push("seed"))
    );
    deployBatch = target().forEach(() => ["a"], () => ({ seed: this.seed }));
  }
  const build = new CD();
  discoverTargets(build);
  // `seed` itself succeeded; the fan-out's only item failed — which is why the
  // run is being cancelled — so the item has nothing to undo.
  const record = craftRecord("deployBatch", {
    "seed": { status: "succeeded", meta: {} },
    "deployBatch[a].seed": { status: "failed", meta: {} },
  });
  const outcome = await runCompensations(
    [build.seed, build.deployBatch],
    record,
    {
      runId: "run",
      signals: new Map(),
      reporter: capturingReporter().reporter,
    },
  );
  assertEquals(build.seed.name_, "seed"); // the factory's builder is untouched
  assertEquals(undone, ["seed"]); // …so its own compensation still runs
  assertEquals(outcome.attempts.map((a) => a.forTarget), ["seed"]);
});

Deno.test("a fan-out parent's own onCancel runs after its item compensations", async () => {
  const seq: string[] = [];
  class CD extends Build {
    deployBatch = target()
      .forEach(
        () => ["a", "b"],
        (repo) => ({
          deploy: target().executes(() => {}).onCancel(() =>
            target().executes(() => void seq.push(`item:${repo}`))
          ),
        }),
      )
      .onCancel(() => this.batchRollback);
    batchRollback = target().executes(() => void seq.push("parent"));
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deployBatch", {
    "deployBatch": { status: "succeeded", meta: {} },
    "deployBatch[a].deploy": { status: "succeeded", meta: {} },
    "deployBatch[b].deploy": { status: "succeeded", meta: {} },
  });
  await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
  });
  // Items unwind first (reverse), then the batch-level compensation.
  assertEquals(seq, ["item:b", "item:a", "parent"]);
});

Deno.test("cancel degrades to base order when orderWith fails, still compensating", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    // The ordering provider is reachable at run time, but not at cancel time
    // (a fresh `zuke cancel` process can't reach the dependency-graph service).
    let failOrder = false;
    const makeBuild = () => {
      class CD extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => void undone.push("deploy"));
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
        override orderWith(): Promise<OrderingEdge[]> {
          return failOrder
            ? Promise.reject(new Error("graph service down"))
            : Promise.resolve([]);
        }
      }
      const build = new CD();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    failOrder = true; // the provider now rejects
    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
    });
    // The run still settles cancelled with its compensation run — never stranded
    // `cancelling` with rollbacks lost.
    assertEquals(result.status, "cancelled");
    assertEquals(undone, ["deploy"]);
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

/** Force a run to `cancelling`, retrying the CAS until it lands. */
async function forceCancelling(
  store: StateStore,
  runId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error(`run ${runId} vanished`);
    const put = await store.putRun(
      { ...loaded.record, status: "cancelling" },
      loaded.version,
    );
    if (put.ok) return;
  }
  throw new Error(`could not move run ${runId} to cancelling`);
}

/** Poll until `ready()` or the bound elapses (keeps a wedged test from hanging). */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; !ready() && i < 400; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

Deno.test("a second cancelRun is a no-op while the first holds the cancel lock", async () => {
  await withTempStore(async (store) => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const undone: string[] = [];
    const makeBuild = (blocking: boolean) => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(async () => {
          undone.push("deploy");
          if (blocking) await blocked; // hold the cancel lock mid-walk
        });
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const b = new B();
      discoverTargets(b);
      return b;
    };
    const a = makeBuild(true);
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    // Canceller A starts and blocks mid-compensation, holding the cancel lock.
    const first = cancelRun(makeBuild(true), {
      runId: id,
      stateStore: store,
      silent: true,
      actor: "a",
    });
    await until(() => undone.length > 0);

    // Canceller B arrives while A holds the lock → friendly no-op, no walk, no
    // premature settlement (F7).
    const second = await cancelRun(makeBuild(false), {
      runId: id,
      stateStore: store,
      silent: true,
      actor: "b",
    });
    assertEquals(second.noop, true);
    assertEquals(second.status, "cancelling");
    assertEquals((await store.getRun(id))?.record.status, "cancelling");

    // Release A; it settles the run, having compensated exactly once.
    release();
    const firstResult = await first;
    assertEquals(firstResult.noop, false);
    assertEquals(firstResult.status, "cancelled");
    assertEquals(undone, ["deploy"]);
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("a concurrent cancelRun is a no-op while the executor compensates in-process", async () => {
  await withTempStore(async (store) => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    let workStarted!: () => void;
    const workRunning = new Promise<void>((r) => {
      workStarted = r;
    });
    const undone: string[] = [];
    const controller = new AbortController();
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(async () => {
        undone.push("deploy");
        await blocked; // hold the executor's cancel lock mid-walk
      });
      work = target()
        .dependsOn(this.deploy)
        .executes((ctx) => {
          workStarted();
          return new Promise<void>((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
        });
    }
    const b = new B();
    discoverTargets(b);

    // Start the run; once `work` is running, abort to trigger the executor's own
    // in-process compensation (which holds the cancel lock while rolling back).
    const runP = execute(b, b.work, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
    });
    await workRunning;
    controller.abort();
    await until(() => undone.length > 0);

    // A `zuke cancel` racing the live in-process compensation is a no-op — it
    // must not settle the run (declaring "no compensations") over the walk (F7).
    const b2 = new B();
    discoverTargets(b2);
    const id = (await store.listRuns({}))[0].id;
    const other = await cancelRun(b2, {
      runId: id,
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(other.noop, true);
    assertEquals((await store.getRun(id))?.record.status, "cancelling");

    // Release the executor's compensation; it settles the run once.
    release();
    const runResult = await runP;
    assertEquals(runResult.cancelled, true);
    assertEquals(undone, ["deploy"]); // compensation ran exactly once
    assertEquals((await store.getRun(id))?.record.status, "cancelled");
  });
});

Deno.test("the executor defers when another process already holds the cancel lock", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let workStarted!: () => void;
    const workRunning = new Promise<void>((r) => {
      workStarted = r;
    });
    const controller = new AbortController();
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes(() => void undone.push("deploy"));
      work = target()
        .dependsOn(this.deploy)
        .executes((ctx) => {
          workStarted();
          return new Promise<void>((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
        });
    }
    const b = new B();
    discoverTargets(b);
    const runP = execute(b, b.work, {
      silent: true,
      stateStore: store,
      signal: controller.signal,
    });
    await workRunning;
    // A separate process grabs the run's cancel lock first.
    const id = (await store.listRuns({}))[0].id;
    const held = await store.acquireLock(
      lockKey("zuke-cancel", id),
      { actor: "other", runId: id, since: new Date().toISOString() },
      30_000,
    );
    if (!held.ok) throw new Error("expected to acquire the cancel lock");

    // The executor self-cancels but cannot get the lock, so it defers to the
    // holder: it drains and runs NO compensations (F7).
    controller.abort();
    const runResult = await runP;
    assertEquals(runResult.cancelled, true);
    assertEquals(undone, []); // the lock holder owns the compensation walk
    await store.releaseLock(lockKey("zuke-cancel", id), held.token);
  });
});

Deno.test("a degraded record compensates targets whose settlement was lost", async () => {
  // The record lost a state write for good, so a target that really did succeed
  // can still be recorded `pending` — or have no row at all. Skipping those
  // leaves real side effects un-rolled-back, so cancel treats every target whose
  // success cannot be ruled out as possibly-succeeded and compensates it.
  const undone: string[] = [];
  const info: string[] = [];
  class CD extends Build {
    deploy = target().executes(() => {}).onCancel(() => this.rollbackDeploy);
    rollbackDeploy = target().executes(() => void undone.push("deploy"));
    migrate = target()
      .dependsOn(this.deploy)
      .executes(() => {})
      .onCancel(() => this.rollbackMigrate);
    rollbackMigrate = target().executes(() => void undone.push("migrate"));
  }
  const build = new CD();
  discoverTargets(build);
  const record: RunRecord = {
    ...craftRecord("migrate", {
      // Recorded pending, but its meta proves the body got as far as writing it.
      deploy: { status: "pending", meta: { slot: "sit-7" } },
      // migrate has no row at all — the lost write took it with it.
    }),
    degraded: true,
  };
  const outcome = await runCompensations(
    [build.deploy, build.migrate],
    record,
    {
      runId: "run",
      signals: new Map(),
      reporter: { info: (l) => void info.push(l), error: () => {} },
    },
  );
  assertEquals(undone, ["migrate", "deploy"]);
  assertEquals(outcome.compensated.length, 2);
  // The output says plainly why each cleanup ran.
  assertStringIncludes(info.join("\n"), "record is incomplete");
  assertStringIncludes(info.join("\n"), 'deploy" is recorded pending');
  assertStringIncludes(info.join("\n"), 'migrate" is not recorded');
});

Deno.test("a healthy record still skips a pending target's compensation", async () => {
  // The flag is what licenses the extra cleanup: a record with nothing missing
  // keeps exactly the settled behaviour — a target that never ran is not undone.
  const undone: string[] = [];
  class CD extends Build {
    deploy = target().executes(() => {}).onCancel(() => this.rollbackDeploy);
    rollbackDeploy = target().executes(() => void undone.push("deploy"));
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deploy", {
    deploy: { status: "pending", meta: {} },
  });
  const outcome = await runCompensations([build.deploy], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
  });
  assertEquals(undone, []);
  assertEquals(outcome.attempts, []);
});

Deno.test("a degraded record compensates a pending fan-out item", async () => {
  // Same defect one level down: an item recorded pending on a degraded record
  // may have deployed. A failed one is not compensated either way — its
  // settlement landed, so nothing about it is unproven.
  const undone: string[] = [];
  class CD extends Build {
    deployBatch = target().forEach(
      () => ["a", "b", "c"],
      (repo) => ({
        deploy: target().executes(() => {}).onCancel(() =>
          target().executes(() => void undone.push(repo))
        ),
      }),
    );
  }
  const build = new CD();
  discoverTargets(build);
  const record: RunRecord = {
    ...craftRecord("deployBatch", {
      "deployBatch[a].deploy": { status: "succeeded", meta: {} },
      "deployBatch[b].deploy": { status: "pending", meta: {} },
      "deployBatch[c].deploy": { status: "failed", meta: {} },
    }),
    degraded: true,
  };
  const outcome = await runCompensations([build.deployBatch], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
  });
  assertEquals(undone, ["b", "a"]);
  assertEquals(outcome.attempts.length, 2);
});

Deno.test("cancelRun re-reads the record after transitioning to cancelling", async () => {
  // The transition's compare-and-swap returns the record as it looked *before*
  // the write, so a settlement that lands in that window is invisible in it —
  // and the owning process lands exactly one there: when its own write loses to
  // the cancel, it re-applies the just-finished target onto the cancelling
  // record. Deciding from the pre-transition snapshot leaves that deploy, which
  // really happened, un-rolled-back.
  await withTemp(async (dir) => {
    const undone: string[] = [];
    let slot: unknown;
    class CD extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      rollback = target().executes((ctx) => {
        undone.push("deploy");
        slot = ctx.state.get().slot;
      });
    }
    const build = new CD();
    discoverTargets(build);
    const store = new SettlesAfterCancelling(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "running", meta: {} } }),
      id: "run-late",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    const result = await cancelRun(build, {
      runId: "run-late",
      stateStore: store,
      silent: true,
      actor: "ops",
    });
    assertEquals(result.status, "cancelled");
    // Compensated from the settlement that landed after the transition, and from
    // the metadata that came with it.
    assertEquals(undone, ["deploy"]);
    assertEquals(slot, "sit-9");
  });
});

/**
 * A store that lands one extra write the instant the run turns `cancelling`,
 * settling `deploy` — what the owning process's writer does when its own
 * compare-and-swap loses to the canceller's: it re-applies the mutation onto the
 * cancelling record, after the canceller's snapshot was taken.
 */
class SettlesAfterCancelling extends FileSystemStateStore {
  #landed = false;
  /** Persist normally, then land the racing settlement exactly once. */
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    const result = await super.putRun(record, expected);
    if (!result.ok || this.#landed || record.status !== "cancelling") {
      return result;
    }
    this.#landed = true;
    const loaded = await this.getRun(record.id);
    if (loaded !== null) {
      const next = structuredClone(loaded.record);
      next.targets.deploy = { status: "succeeded", meta: { slot: "sit-9" } };
      await super.putRun(next, loaded.version);
    }
    return result;
  }
}

/**
 * A store where the run finishes the instant a canceller tries to move it to
 * `cancelling` — the transition's compare-and-swap loses, and the re-read finds
 * the run terminal.
 */
class FinishesBeforeCancelling extends FileSystemStateStore {
  #landed = false;
  /** Land a competing `succeeded` write, then let the CAS conflict with it. */
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status !== "cancelling" || this.#landed) {
      return await super.putRun(record, expected);
    }
    this.#landed = true;
    const loaded = await this.getRun(record.id);
    if (loaded !== null) {
      const winner = structuredClone(loaded.record);
      winner.status = "succeeded";
      await super.putRun(winner, loaded.version);
    }
    return await super.putRun(record, expected); // now conflicts
  }
}

Deno.test("a cancel that loses the transition race reports the run's terminal status", async () => {
  // The run finished between the canceller's read and its write. The CAS
  // conflicts, the re-read finds `succeeded`, and the cancel becomes a
  // friendly no-op naming that status — never a walk over a finished run.
  await withTemp(async (dir) => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const build = new B();
    discoverTargets(build);
    const store = new FinishesBeforeCancelling(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "succeeded", meta: {} } }),
      id: "run-race",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    const lines: string[] = [];
    const result = await cancelRun(build, {
      runId: "run-race",
      stateStore: store,
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    assertEquals(result.noop, true);
    assertEquals(result.status, "succeeded");
    assertEquals(
      lines.some((l) => l.includes("already succeeded; nothing to cancel")),
      true,
    );
    assertEquals((await store.getRun("run-race"))?.record.status, "succeeded");
  });
});

/** A store where the run vanishes the moment the transition CAS conflicts. */
class VanishesOnCancel extends FileSystemStateStore {
  #conflicted = false;
  /** Conflict the first `cancelling` write; the run is gone after that. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "cancelling" && !this.#conflicted) {
      this.#conflicted = true;
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
  /** Pruned mid-cancel: nothing to read back. */
  override getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    if (this.#conflicted) return Promise.resolve(null);
    return super.getRun(id);
  }
}

Deno.test("a run that vanishes mid-cancel is a no-op, not a crash", async () => {
  // Pruned between the read and the write (a retention sweep, a manual
  // delete): there is nothing left to cancel, and the caller is told so.
  await withTemp(async (dir) => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const build = new B();
    discoverTargets(build);
    const store = new VanishesOnCancel(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "succeeded", meta: {} } }),
      id: "run-gone",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    const result = await cancelRun(build, {
      runId: "run-gone",
      stateStore: store,
      silent: true,
    });
    assertEquals(result.noop, true);
    // With nothing left to read, the status defaults to what a cancel means.
    assertEquals(result.status, "cancelled");
  });
});

/** A store that never accepts the `cancelling` transition. */
class RefusesCancelling extends FileSystemStateStore {
  /** Conflict every `cancelling` write. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "cancelling") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("cancelRun surfaces a store that never accepts the transition", async () => {
  // Bounded retries: a store outage (or a pathological writer) must produce a
  // named error, not an infinite CAS loop.
  await withTemp(async (dir) => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const build = new B();
    discoverTargets(build);
    const store = new RefusesCancelling(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "succeeded", meta: {} } }),
      id: "run-stuck",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    await assertRejects(
      () =>
        cancelRun(build, {
          runId: "run-stuck",
          stateStore: store,
          silent: true,
        }),
      Error,
      "gave up cancelling",
    );
    // The run is untouched, so a retry can still cancel it.
    assertEquals((await store.getRun("run-stuck"))?.record.status, "suspended");
  });
});

/** A store where the run vanishes right after the `cancelling` transition lands. */
class VanishesAfterCancelling extends FileSystemStateStore {
  #transitioned = false;
  /** Persist normally, remembering when the transition landed. */
  override async putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    const result = await super.putRun(record, expected);
    if (result.ok && record.status === "cancelling") this.#transitioned = true;
    return result;
  }
  /** Gone from the store from that moment on. */
  override getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    if (this.#transitioned) return Promise.resolve(null);
    return super.getRun(id);
  }
}

Deno.test("a run that vanishes after the transition still gets its compensations", async () => {
  // The canceller's own snapshot is the last word when the record disappears:
  // the walk still runs from it, and the missing settlement write is a clean
  // return, not an error — the record it would update no longer exists.
  await withTemp(async (dir) => {
    const undone: string[] = [];
    class B extends Build {
      rollback = target().executes(() => void undone.push("deploy"));
      deploy = target().onCancel(this.rollback).executes(() => {});
    }
    const build = new B();
    discoverTargets(build);
    const store = new VanishesAfterCancelling(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "succeeded", meta: {} } }),
      id: "run-late-gone",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    const result = await cancelRun(build, {
      runId: "run-late-gone",
      stateStore: store,
      silent: true,
    });
    assertEquals(result.noop, false);
    assertEquals(result.status, "cancelled");
    assertEquals(undone, ["deploy"]); // the walk ran from the snapshot
    assertEquals(result.compensated, ["rollback"]);
  });
});

/** A store that never accepts a terminal settlement write. */
class RefusesSettlement extends FileSystemStateStore {
  /** Conflict every `cancelled` write. */
  override putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<PutResult> {
    if (record.status === "cancelled") {
      return Promise.resolve({ ok: false, conflict: true });
    }
    return super.putRun(record, expected);
  }
}

Deno.test("cancelRun surfaces a store that never accepts the settlement", async () => {
  // The other bounded loop: compensations ran but the terminal write cannot
  // land. Surfacing the outage beats silently leaving the run `cancelling` —
  // and a re-cancel then recovers it.
  await withTemp(async (dir) => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const build = new B();
    discoverTargets(build);
    const store = new RefusesSettlement(`${dir}/runs`, defaultStateHost);
    const seeded: RunRecord = {
      ...craftRecord("deploy", { deploy: { status: "succeeded", meta: {} } }),
      id: "run-unsettled",
      status: "suspended",
    };
    assertEquals((await store.putRun(seeded, null)).ok, true);

    await assertRejects(
      () =>
        cancelRun(build, {
          runId: "run-unsettled",
          stateStore: store,
          silent: true,
        }),
      Error,
      "gave up finalizing",
    );
    // Left `cancelling`, which a re-cancel recovers (tested above).
    assertEquals(
      (await store.getRun("run-unsettled"))?.record.status,
      "cancelling",
    );
  });
});

Deno.test("an extra compensation naming a missing target is skipped, not fatal", async () => {
  // The `also` list is how a timed-out wait's onTimeout names a specific
  // compensation target. A build edit can remove that target before the
  // timeout fires; the cancel must still unwind everything else.
  await withTempStore(async (store) => {
    const undone: string[] = [];
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => void undone.push("deploy"));
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    const result = await cancelRun(makeBuild(), {
      runId: id,
      stateStore: store,
      silent: true,
      also: ["ghost"], // no such target in this build
    });
    assertEquals(result.status, "cancelled");
    assertEquals(result.compensated, ["rollback"]); // the rest still ran
    assertEquals(result.failures, []);
  });
});

Deno.test("the default reporter routes cancel diagnostics to the console's error stream", async () => {
  // With no reporter and no `silent`, cancel prints through the console — and
  // its diagnostics (a failed compensation) must land on stderr, where CI log
  // scrapers and shell redirections expect errors.
  await withTempStore(async (store) => {
    const makeBuild = () => {
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        rollback = target().executes(() => {
          throw new Error("cleanup boom");
        });
        gate = target()
          .dependsOn(this.deploy)
          .waitsFor((s) => s.on(externalSignal("x")));
      }
      const build = new B();
      discoverTargets(build);
      return build;
    };
    const a = makeBuild();
    await execute(a, a.gate, { silent: true, stateStore: store });
    const id = (await store.listRuns({}))[0].id;

    const logs: string[] = [];
    const errs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...data: unknown[]) => void logs.push(data.join(" "));
    console.error = (...data: unknown[]) => void errs.push(data.join(" "));
    try {
      const result = await cancelRun(makeBuild(), {
        runId: id,
        stateStore: store,
      });
      assertEquals(result.failures.length, 1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    assertEquals(
      errs.some((l) =>
        l.includes("compensation") && l.includes("cleanup boom")
      ),
      true,
    );
    // Progress narration stays on stdout.
    assertEquals(logs.some((l) => l.includes("compensating")), true);
  });
});

Deno.test("without a redactor, a compensation failure message is kept verbatim", async () => {
  // The executor's in-process walk can run with no redactor (no secrets are
  // known); the failure text must then pass through untouched — masking is
  // opt-in, not a mangling of every message.
  class CD extends Build {
    deploy = target().executes(() => {}).onCancel(() => this.rollback);
    rollback = target().executes(() => {
      throw new Error("exact diagnostic text");
    });
  }
  const build = new CD();
  discoverTargets(build);
  const record = craftRecord("deploy", {
    deploy: { status: "succeeded", meta: {} },
  });
  const outcome = await runCompensations([build.deploy], record, {
    runId: "run",
    signals: new Map(),
    reporter: { info: () => {}, error: () => {} },
    // no redactor
  });
  assertEquals(outcome.failures.length, 1);
  assertEquals(outcome.failures[0].error, "exact diagnostic text");
});
