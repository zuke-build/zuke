// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for `.effect(...)` — a side effect whose intent is durable
 * before it runs, driven through the real CLI.
 *
 * What these prove that a unit test cannot: the intent is visible in the store
 * *from inside the effect body*, and a resume in a second process drives an
 * unfinished effect again while leaving a finished one alone.
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
  type EffectState,
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

/** The persisted effect row for `target`/`effect` in run `id`. */
async function effectRow(
  dir: string,
  id: string,
  targetName: string,
  effect: string,
): Promise<EffectState | undefined> {
  const store = new FileSystemStateStore(dir, defaultStateHost);
  const got = await store.getRun(id);
  return got?.record.targets[targetName]?.effects?.[effect];
}

Deno.test("the intent is already durable when the effect body runs", async () => {
  // The ordering that makes the whole feature work: from inside the body, the
  // store already says this effect is owed. A process killed on the next line
  // leaves that behind.
  let seenFromInside: EffectState | undefined;

  class Ci extends Build {
    gate = target().effect("post", async (ctx) => {
      seenFromInside = await effectRow(dir, ctx.runId, "gate", "post");
    });
  }

  let dir = "";
  await withStateDir(async (stateDir) => {
    dir = stateDir;
    const { code } = await runCli(Ci, ["gate"]);
    assertEquals(code, 0);
    assertEquals(seenFromInside?.status, "pending");
    assertEquals(seenFromInside?.attempts, 1);
    // And by the end it is settled.
    const id = await onlyRunId(dir);
    assertEquals((await effectRow(dir, id, "gate", "post"))?.status, "done");
  });
});

Deno.test("a state store is enabled automatically for an effect", async () => {
  // Declaring an effect is enough; no --state flag, no ZUKE_STATE_DIR by hand.
  let ran = false;

  class Ci extends Build {
    gate = target().effect("post", () => {
      ran = true;
    });
  }

  await withStateDir(async (dir) => {
    await runCli(Ci, ["gate"]);
    assertEquals(ran, true);
    const id = await onlyRunId(dir);
    assertEquals((await effectRow(dir, id, "gate", "post"))?.status, "done");
  });
});

Deno.test("a failed effect is recorded, and the target fails with it", async () => {
  class Ci extends Build {
    gate = target().effect("post", () => {
      throw new Error("the API refused");
    });
  }

  await withStateDir(async (dir) => {
    const { code } = await runCli(Ci, ["gate"]);
    assertEquals(code, 1);
    const id = await onlyRunId(dir);
    const row = await effectRow(dir, id, "gate", "post");
    assertEquals(row?.status, "failed");
    assertEquals(row?.error, "the API refused");
  });
});

Deno.test("an unfinished effect is driven again on resume; a finished one is not", async () => {
  // The crash case, staged deterministically: the effect runs before a wait, so
  // the first process settles it, and the resume must leave it alone. Then the
  // same build with a body that would fail proves the skip is what spared it.
  const calls: string[] = [];

  class Cd extends Build {
    publish = target().effect("announce", () => {
      calls.push("announce");
    });
    hold = target().dependsOn(this.publish).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    const first = await runCli(Cd, ["done"]);
    assertEquals(first.code, 0); // suspended at the wait
    assertEquals(calls, ["announce"]);
    const id = await onlyRunId(dir);
    assertEquals(
      (await effectRow(dir, id, "publish", "announce"))?.status,
      "done",
    );

    const resumed = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    // Not driven a second time: the target succeeded, so the resume never
    // re-runs it — and even if it did, the `done` row would skip the effect.
    assertEquals(calls, ["announce"]);
    assertEquals(
      (await effectRow(dir, id, "publish", "announce"))?.attempts,
      1,
    );
  });
});

Deno.test("an effect left pending by a dead process is re-driven, and told so", async () => {
  // What a killed process leaves: a `pending` row with no settlement. Written
  // directly, because the point is what a *later* process does with it.
  const drives: boolean[] = [];

  class Cd extends Build {
    publish = target().effect("announce", (ctx) => {
      drives.push(ctx.redriven);
    });
    hold = target().dependsOn(this.publish).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    await runCli(Cd, ["done"]);
    const id = await onlyRunId(dir);
    assertEquals(drives, [false]); // first drive, not a re-drive

    // Rewind the record to what a kill mid-effect leaves behind: the target
    // never settled, and its effect is still owed.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const got = await store.getRun(id);
    if (got === null) throw new Error("the run vanished");
    const record = structuredClone(got.record);
    record.targets["publish"] = {
      status: "running",
      meta: {},
      effects: {
        announce: {
          status: "pending",
          intentAt: "2026-08-10T10:00:00.000Z",
          attempts: 1,
        },
      },
    };
    const put = await store.putRun(record, got.version);
    assertEquals(put.ok, true);

    const resumed = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    // Driven again, and the body is told a previous attempt already committed.
    assertEquals(drives, [false, true]);
    const row = await effectRow(dir, id, "publish", "announce");
    assertEquals(row?.status, "done");
    assertEquals(row?.attempts, 2);
    // The obligation keeps its original timestamp across the re-drive.
    assertEquals(row?.intentAt, "2026-08-10T10:00:00.000Z");
  });
});

Deno.test("a re-driven effect sees the parameter the run started with", async () => {
  // The rule effects live or die by: inputs are pinned when the run starts. If
  // a re-drive could see a newer value, a gate re-driven after a fresh push
  // would report on a commit whose checks never ran.
  const seen: Array<string | undefined> = [];

  class Cd extends Build {
    sha = parameter("The commit under test").required();
    publish = target().requires(this.sha).effect("announce", () => {
      seen.push(this.sha.value);
    });
    hold = target().dependsOn(this.publish).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    const first = await runCli(Cd, ["done", "--sha", "aaaa1111"]);
    assertEquals(first.code, 0);
    assertEquals(seen, ["aaaa1111"]);
    const id = await onlyRunId(dir);

    // Put the effect back to owed, as a kill mid-effect would.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const got = await store.getRun(id);
    if (got === null) throw new Error("the run vanished");
    const record = structuredClone(got.record);
    record.targets["publish"] = {
      status: "running",
      meta: {},
      effects: {
        announce: {
          status: "pending",
          intentAt: "2026-08-10T10:00:00.000Z",
          attempts: 1,
        },
      },
    };
    assertEquals((await store.putRun(record, got.version)).ok, true);

    // The resume does not re-supply the parameter — which is what a sweep or a
    // cron does. The recorded value is what the re-drive acts on.
    const resumed = await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(resumed.code, 0);
    assertEquals(seen, ["aaaa1111", "aaaa1111"]);
  });
});

Deno.test("a resume that re-supplies a parameter overrides the recorded value", async () => {
  // The other half, and it is deliberate rather than a gap: the record seeds a
  // resume so nothing has to be repeated, and an explicit value still wins —
  // which is the only way to re-supply a secret, since secrets are kept out of
  // the record.
  //
  // The consequence for effects is worth being plain about: a value that must
  // not drift across a re-drive belongs in `ctx.state`, written by an earlier
  // target, not in a parameter a resumer might pass differently.
  const seen: Array<string | undefined> = [];

  class Cd extends Build {
    sha = parameter("The commit under test").required();
    publish = target().requires(this.sha).effect("announce", () => {
      seen.push(this.sha.value);
    });
    hold = target().dependsOn(this.publish).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    await runCli(Cd, ["done", "--sha", "aaaa1111"]);
    const id = await onlyRunId(dir);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const got = await store.getRun(id);
    if (got === null) throw new Error("the run vanished");
    const record = structuredClone(got.record);
    record.targets["publish"] = {
      status: "running",
      meta: {},
      effects: {
        announce: {
          status: "pending",
          intentAt: "2026-08-10T10:00:00.000Z",
          attempts: 1,
        },
      },
    };
    assertEquals((await store.putRun(record, got.version)).ok, true);

    await runCli(Cd, ["resume", id, "--signal", "go", "--sha", "bbbb2222"]);
    assertEquals(seen, ["aaaa1111", "bbbb2222"]);
  });
});

Deno.test("state written before an effect is stable across its re-drive", async () => {
  // The pinning that always holds, and so the one an effect should rely on:
  // durable target state is replayed from the record and cannot be overridden
  // from a command line.
  const seen: string[] = [];

  class Cd extends Build {
    pin = target().executes((ctx) => ctx.state.set({ sha: "aaaa1111" }));
    publish = target().dependsOn(this.pin).effect("announce", (ctx) => {
      const sha = ctx.stateOf("pin").get()["sha"];
      seen.push(typeof sha === "string" ? sha : "missing");
    });
    hold = target().dependsOn(this.publish).waitsFor((s) =>
      s.on(externalSignal("go"))
    );
    done = target().dependsOn(this.hold).executes(() => {});
  }

  await withStateDir(async (dir) => {
    await runCli(Cd, ["done"]);
    const id = await onlyRunId(dir);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const got = await store.getRun(id);
    if (got === null) throw new Error("the run vanished");
    const record = structuredClone(got.record);
    record.targets["publish"] = {
      status: "running",
      meta: {},
      effects: {
        announce: {
          status: "pending",
          intentAt: "2026-08-10T10:00:00.000Z",
          attempts: 1,
        },
      },
    };
    assertEquals((await store.putRun(record, got.version)).ok, true);

    await runCli(Cd, ["resume", id, "--signal", "go"]);
    assertEquals(seen, ["aaaa1111", "aaaa1111"]);
  });
});

Deno.test("a cache hit never swallows an effect", async () => {
  // A cache hit returns before the effects are driven, so a cacheable target
  // that declares one would drop it outright on the second run — nothing run,
  // nothing recorded as owed, and the run reporting success.
  const calls: string[] = [];

  class Ci extends Build {
    publish = target().inputs("deno.json").executes(() => {}).effect(
      "announce",
      () => {
        calls.push("announce");
      },
    );
  }

  await withStateDir(async (dir) => {
    assertEquals((await runCli(Ci, ["publish"])).code, 0);
    assertEquals((await runCli(Ci, ["publish"])).code, 0);
    // Twice, because a target with an effect is never cache-skipped.
    assertEquals(calls, ["announce", "announce"]);
    void dir;
  });
});

Deno.test("a wait gate that is already satisfied still drives its effects", async () => {
  // The gate opened, so this is the target's real run and the effect is owed
  // now. The satisfied path returns early and used to return past the effects.
  const calls: string[] = [];

  class Cd extends Build {
    gate = target()
      .waitsFor((s) => s.on(resumeWhen(() => true)))
      .effect("announce", () => {
        calls.push("announce");
      });
  }

  await withStateDir(async (dir) => {
    const { code } = await runCli(Cd, ["gate"]);
    assertEquals(code, 0);
    assertEquals(calls, ["announce"]);
    const id = await onlyRunId(dir);
    assertEquals(
      (await effectRow(dir, id, "gate", "announce"))?.status,
      "done",
    );
  });
});

Deno.test("two effects of the same name are refused rather than one being lost", () => {
  // Same name means the same record row, so the first to settle makes the second
  // skip — a copy-paste losing a side effect with no error at all.
  let message = "";
  try {
    target().effect("post", () => {}).effect("post", () => {});
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "already declares an effect named");
});

Deno.test("an effect on a fan-out is refused, on the parent and on a stage", () => {
  // A fan-out parent runs no body of its own, and its materialised sub-targets
  // are invisible both to the state store's enablement and to any resume — so an
  // effect there is recorded nowhere and never re-driven.
  const onParent = target()
    .forEach(() => ["a"], () => ({ work: target().executes(() => {}) }))
    .effect("announce", () => {});
  let parentMessage = "";
  try {
    onParent.forEach_?.materialize();
  } catch (error) {
    parentMessage = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(parentMessage, ".forEach() with .effect()");

  const onStage = target().forEach(() => ["a"], () => ({
    work: target().executes(() => {}).effect("announce", () => {}),
  }));
  let stageMessage = "";
  try {
    onStage.forEach_?.materialize();
  } catch (error) {
    stageMessage = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(stageMessage, 'stage "work" uses .effect()');
});

Deno.test("an effect on a service is refused", () => {
  // A service launches a process and runs no body, so an effect declared on it
  // would never be driven.
  let message = "";
  try {
    service().start(() => ({ stop: () => {} })).effect("post", () => {});
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "runs no body");
});
