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
import { target, type TargetBuilder } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { resolveFailureDispositions } from "../src/on_failure.ts";
import { cancelRun } from "../src/cancel.ts";
import { messageOf } from "../src/internal.ts";
import { withTempStore } from "./_store.ts";

Deno.test("resolveFailureDispositions keeps only the cancelling dispositions", () => {
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
  const resolved = resolveFailureDispositions([
    b.plain,
    b.explicit,
    b.cancel,
    b.named,
  ]);
  if (!resolved.ok) throw resolved.error;
  assertEquals([...resolved.cancelling.keys()], ["cancel", "named"]);
  assertEquals(resolved.cancelling.get("cancel"), "cancel-run");
  assertEquals(resolved.cancelling.get("named") === b.rollback, true);
});

/** Resolve one target's disposition and return the refusal message. */
function refusalOf(t: TargetBuilder): string {
  const resolved = resolveFailureDispositions([t]);
  return resolved.ok ? "accepted" : resolved.error.message;
}

Deno.test("resolveFailureDispositions refuses a thunk that throws, naming the target", () => {
  class B extends Build {
    verify = target()
      .onFailure(() => {
        throw new Error("lookup failed");
      })
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertEquals(
    refusalOf(b.verify),
    'Target "verify" .onFailure(...) threw: lookup failed',
  );
});

Deno.test("resolveFailureDispositions refuses a disposition that is not a target", () => {
  class B extends Build {
    verify = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  // @ts-expect-error — deliberately type-unsafe: a forward reference or an
  // untyped caller can hand back anything at run time, and the guard must hold.
  b.verify.onFailure(() => undefined);
  assertStringIncludes(refusalOf(b.verify), "returned undefined");
});

Deno.test("resolveFailureDispositions refuses naming the failing target itself", () => {
  class B extends Build {
    verify: TargetBuilder = target().onFailure(() => this.verify)
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertStringIncludes(refusalOf(b.verify), "names the target itself");
});

Deno.test("resolveFailureDispositions refuses a target not declared on the build", () => {
  const stray = target().executes(() => {});
  class B extends Build {
    verify = target().onFailure(() => stray).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertStringIncludes(refusalOf(b.verify), "not declared on this build");
});

Deno.test("resolveFailureDispositions refuses a cancelling target that also proceeds after failure", () => {
  class B extends Build {
    verify = target()
      .proceedAfterFailure()
      .onFailure(() => "cancel-run")
      .executes(() => {});
    // "fail" stays compatible: it asks for nothing proceedAfterFailure denies.
    lenient = target()
      .proceedAfterFailure()
      .onFailure(() => "fail")
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertStringIncludes(refusalOf(b.verify), ".proceedAfterFailure()");
  assertEquals(refusalOf(b.lenient), "accepted");
});

Deno.test("a refused disposition fails the run up front, before any target runs", async () => {
  // Before the fix the thunk was called unguarded at setup, so its throw
  // escaped execute() as a raw exception instead of a failed result.
  await withTempStore(async (store) => {
    let ran = false;
    class B extends Build {
      verify = target()
        .onFailure(() => {
          throw new Error("boom");
        })
        .executes(() => void (ran = true));
    }
    const b = new B();
    discoverTargets(b);
    const lines: string[] = [];
    const result = await execute(b, b.verify, {
      stateStore: store,
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    assertEquals(result.ok, false);
    assertEquals(ran, false);
    assertStringIncludes(messageOf(result.error), "threw: boom");
    assertStringIncludes(lines.join("\n"), 'Target "verify" .onFailure(...)');
    assertEquals((await store.listRuns({})).length, 0);
  });
});

for (const parallel of [false, true]) {
  Deno.test(`a disposition thunk is evaluated once, so a later throw cannot strand the run (parallel: ${parallel})`, async () => {
    // Before the fix the thunk ran again inside the scheduler's settle path: a
    // thunk that threw on its second call left the record \`running\` and, in
    // the parallel scheduler, raised an unhandled rejection.
    await withTempStore(async (store) => {
      let calls = 0;
      const undone: string[] = [];
      class B extends Build {
        deploy = target().executes(() => {}).onCancel(() => this.rollback);
        verify = target()
          .dependsOn(this.deploy)
          .onFailure(() => {
            calls++;
            if (calls > 1) throw new Error("second call");
            return "cancel-run";
          })
          .executes(() => {
            throw new Error("unhealthy");
          });
        rollback = target().executes(() => void undone.push("rollback"));
      }
      const b = new B();
      discoverTargets(b);
      const result = await execute(b, b.verify, {
        silent: true,
        stateStore: store,
        parallel,
      });
      assertEquals(calls, 1);
      assertEquals(result.cancelled, true);
      assertEquals(undone, ["rollback"]);
      const loaded = result.runId ? await store.getRun(result.runId) : null;
      assertEquals(loaded?.record.status, "cancelled");
    });
  });
}

Deno.test("the result carries the cancelling target's error, not an earlier failure", async () => {
  // Before the fix the result reused the run's first failure, so a plain
  // failure that landed first was reported as the reason for the rollback.
  await withTempStore(async (store) => {
    let plainFailed: () => void = () => {};
    const plainDone = new Promise<void>((r) => (plainFailed = r));
    class B extends Build {
      plain = target().executes(() => {
        plainFailed();
        throw new Error("plain-error");
      });
      check = target()
        .onFailure(() => "cancel-run")
        .executes(async () => {
          await plainDone;
          throw new Error("check-error");
        });
      all = target().dependsOn(this.plain, this.check).executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.all, {
      silent: true,
      stateStore: store,
      parallel: true,
    });
    assertEquals(result.cancelled, true);
    assertEquals(messageOf(result.error), "check-error");
  });
});

Deno.test("a failure-cancel never reopens a run another process already cancelled", async () => {
  // A \`zuke cancel\` finishes first; the target then fails with cancel-run.
  // Before the fix the writer's \`cancelling\` landed over the terminal
  // \`cancelled\` and the run was stranded there. The same race existed for
  // Ctrl-C; the guard is in the writer, so it covers both.
  await withTempStore(async (store) => {
    const undone: string[] = [];
    let runId = "";
    class B extends Build {
      deploy = target()
        .executes((ctx) => void (runId = ctx.runId))
        .onCancel(() => this.rollback);
      verify = target()
        .dependsOn(this.deploy)
        .onFailure(() => this.diagnose)
        .executes(async (ctx) => {
          // State writes are serialized, so awaiting one guarantees deploy's
          // own `succeeded` write has landed before the canceller reads the
          // record; otherwise it may see deploy pending and skip its rollback.
          await ctx.state.set({ checked: true });
          await cancelRun(this, { runId, stateStore: store, silent: true });
          throw new Error("unhealthy");
        });
      rollback = target().executes(() => void undone.push("rollback"));
      diagnose = target().executes(() => void undone.push("diagnose"));
    }
    const b = new B();
    discoverTargets(b);
    const lines: string[] = [];
    const result = await execute(b, b.verify, {
      stateStore: store,
      reporter: { info: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    assertEquals(result.cancelled, true);
    const loaded = result.runId ? await store.getRun(result.runId) : null;
    assertEquals(loaded?.record.status, "cancelled");
    // The external canceller owned the walk: deploy was rolled back once.
    assertEquals(undone, ["rollback"]);
    // The named compensation could not run here, and the output says so.
    assertStringIncludes(
      lines.join("\n"),
      "diagnose (named by verify's .onFailure) did not run",
    );
  });
});

Deno.test("the audit trail names the target whose failure cancelled the run", async () => {
  await withTempStore(async (store) => {
    class B extends Build {
      deploy = target().executes(() => {}).onCancel(() => this.rollback);
      verify = target()
        .dependsOn(this.deploy)
        .onFailure(() => "cancel-run")
        .executes(() => {
          throw new Error("unhealthy");
        });
      rollback = target().executes(() => {});
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.verify, {
      silent: true,
      stateStore: store,
    });
    const loaded = result.runId ? await store.getRun(result.runId) : null;
    const cancel = loaded?.record.events.find((e) => e.tool === "cancel");
    assertEquals(
      cancel?.detail,
      "ran 1 compensation(s); cancelled because verify failed",
    );
  });
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
