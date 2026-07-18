import { assertEquals, assertRejects } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { parameter } from "../src/params.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { cancelRun } from "../src/cancel.ts";
import { resumeRun } from "../src/resume.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost, type StateStore } from "../src/state/store.ts";
import { externalSignal } from "../src/wait.ts";

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
