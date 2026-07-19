import { assertEquals, assertRejects } from "./_assert.ts";
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
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost, type StateStore } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import type { Reporter } from "../src/executor.ts";
import { externalSignal } from "../src/wait.ts";

/** A run record scaffold for driving {@link runCompensations} directly. */
function craftRecord(
  rootTarget: string,
  targets: RunRecord["targets"],
): RunRecord {
  return {
    id: "run",
    build: "B",
    rootTarget,
    status: "cancelling",
    actor: "ops",
    createdAt: "t",
    updatedAt: "t",
    graph: [],
    params: {},
    targets,
    signals: {},
    events: [],
  };
}

/** A reporter that captures error lines (for asserting cancel diagnostics). */
function capturingReporter(): { reporter: Reporter; errors: string[] } {
  const errors: string[] = [];
  return { reporter: { info: () => {}, error: (l) => errors.push(l) }, errors };
}

/** Run `fn` with a temp filesystem store, cleaned up afterwards. */
async function withTempStore(
  fn: (store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
