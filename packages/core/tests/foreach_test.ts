import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute, type Reporter } from "../src/executor.ts";
import { formatGraph, formatList } from "../src/cli.ts";
import {
  discoverParameters,
  parameter,
  resolveParameters,
} from "../src/params.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { externalSignal } from "../src/wait.ts";

/** The message of a failed `execute` result. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A reporter that records every printed line, for asserting output. */
function recorder(): { lines: string[]; reporter: Reporter } {
  const lines: string[] = [];
  return {
    lines,
    reporter: {
      info: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
  };
}

/** Run `fn` with a temp-dir-backed store, cleaned up afterwards. */
async function withStore(
  fn: (store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(new FileSystemStateStore(`${dir}/runs`, defaultStateHost));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("forEach runs each item's stages in order, items in parallel", async () => {
  const log: string[] = [];
  class Batch extends Build {
    deployBatch = target().forEach(
      () => ["a", "b"],
      (repo) => ({
        checks: target().executes(() => void log.push(`checks:${repo}`)),
        deploy: target().executes(() => void log.push(`deploy:${repo}`)),
      }),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.deployBatch, { silent: true });

  assertEquals(result.ok, true);
  // Within an item, checks precede deploy.
  assertEquals(log.indexOf("checks:a") < log.indexOf("deploy:a"), true);
  assertEquals(log.indexOf("checks:b") < log.indexOf("deploy:b"), true);
  assertEquals(log.length, 4);
});

Deno.test("forEach rejects a .waitsFor() on a stage (no resume path)", async () => {
  // A wait gate on a materialised sub-target would be silently swallowed (the
  // run finishes "succeeded" while the row is stranded "waiting"); reject it.
  class Batch extends Build {
    deployBatch = target().forEach(
      () => ["a"],
      () => ({
        gate: target().waitsFor((s) => s.on(externalSignal("go"))),
        deploy: target().executes(() => {}),
      }),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.deployBatch, { silent: true });
  assertEquals(result.ok, false);
  const message = errorMessage(result.error);
  assertStringIncludes(message, "deployBatch");
  assertStringIncludes(message, ".waitsFor()");
  assertStringIncludes(message, ".dependsOn(");
});

Deno.test("the fan-out wait-gate rejection names an undiscovered target as <unnamed>", () => {
  // materialize() can run before discovery assigns a name; the error still reads
  // cleanly (covers the `name_ ?? "<unnamed>"` fallback).
  const t = target()
    .waitsFor((s) => s.on(externalSignal("go")))
    .forEach(() => ["a"], () => ({ deploy: target().executes(() => {}) }));
  const spec = t.forEach_;
  assertEquals(spec !== undefined, true);
  if (spec !== undefined) {
    const error = assertThrows(() => spec.materialize());
    assertStringIncludes(errorMessage(error), '"<unnamed>"');
  }
});

Deno.test("forEach rejects a .waitsFor() on the fan-out target itself", async () => {
  // A wait on the fan-out parent is dispatched before the gate is checked, so it
  // is silently skipped; reject the combination.
  class Batch extends Build {
    deployBatch = target()
      .waitsFor((s) => s.on(externalSignal("go")))
      .forEach(() => ["a"], () => ({ deploy: target().executes(() => {}) }));
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.deployBatch, { silent: true });
  assertEquals(result.ok, false);
  assertStringIncludes(
    errorMessage(result.error),
    "combines .forEach() with .waitsFor()",
  );
});

Deno.test("forEach isolates a failed item with continueOnItemFailure", async () => {
  const log: string[] = [];
  class Batch extends Build {
    deployBatch = target().forEach(
      () => ["a", "b", "c"],
      (repo) => ({
        checks: target().executes(() => {
          if (repo === "b") throw new Error(`cannot deploy ${repo}`);
          log.push(`checks:${repo}`);
        }),
        deploy: target().executes(() => void log.push(`deploy:${repo}`)),
      }),
      (s) => s.continueOnItemFailure(),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.deployBatch, { silent: true });

  // The batch fails (one item failed), but a and c completed end to end.
  assertEquals(result.ok, false);
  assertEquals(log.includes("deploy:a"), true);
  assertEquals(log.includes("deploy:c"), true);
  // b's checks failed, so its deploy never ran.
  assertEquals(log.includes("deploy:b"), false);
});

Deno.test("forEach without isolation stops the batch at the first failure", async () => {
  const log: string[] = [];
  class Batch extends Build {
    deployBatch = target().forEach(
      () => ["a", "b", "c"],
      (repo) => ({
        checks: target().executes(() => {
          if (repo === "b") throw new Error(`bad ${repo}`);
          log.push(`checks:${repo}`);
        }),
        deploy: target().executes(() => void log.push(`deploy:${repo}`)),
      }),
      (s) => s.concurrency(1), // serialise so the halt point is deterministic
    );
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.deployBatch, { silent: true });

  assertEquals(result.ok, false);
  // a completed before b failed; c never started (the batch halted).
  assertEquals(log, ["checks:a", "deploy:a"]);
});

Deno.test("forEach honours the concurrency cap", async () => {
  let active = 0;
  let peak = 0;
  const busy = () =>
    target().executes(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  class Batch extends Build {
    batch = target().forEach(
      () => [1, 2, 3, 4],
      () => ({ run: busy() }),
      (s) => s.concurrency(2),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  await execute(b, b.batch, { silent: true });
  assertEquals(peak, 2); // four items, never more than two in flight
});

Deno.test("forEach concurrency(1) serialises items", async () => {
  let active = 0;
  let peak = 0;
  const busy = () =>
    target().executes(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  class Batch extends Build {
    batch = target().forEach(
      () => [1, 2, 3],
      () => ({ run: busy() }),
      (s) => s.concurrency(1),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  await execute(b, b.batch, { silent: true });
  assertEquals(peak, 1);
});

Deno.test("forEach reports each sub-target and reads a runtime list", async () => {
  const { lines, reporter } = recorder();
  class Batch extends Build {
    repos = parameter("repos").array();
    deployBatch = target().forEach(
      () => this.repos.value,
      (_repo) => ({ deploy: target().executes(() => {}) }),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  await execute(b, b.deployBatch, {
    reporter,
    github: false,
    params: { repos: "x,y" },
  });
  const out = lines.join("\n");
  assertStringIncludes(out, "fan-out over 2 item(s)");
  assertStringIncludes(out, "deployBatch[x].deploy");
  assertStringIncludes(out, "deployBatch[y].deploy");
});

Deno.test("forEach over an empty list succeeds with nothing to run", async () => {
  const { lines, reporter } = recorder();
  class Batch extends Build {
    batch = target().forEach(
      () => [] as string[],
      (_item) => ({ run: target().executes(() => {}) }),
    );
  }
  const b = new Batch();
  discoverTargets(b);
  const result = await execute(b, b.batch, { reporter, github: false });
  assertEquals(result.ok, true);
  assertStringIncludes(lines.join("\n"), "fan-out over 0 items");
});

Deno.test("forEach records per-item sub-target status and metadata in the run", async () => {
  await withStore(async (store) => {
    class Batch extends Build {
      deployBatch = target().forEach(
        () => ["a", "b"],
        (repo) => ({
          deploy: target().executes(async (ctx) => {
            if (repo === "b") throw new Error("boom");
            await ctx.state.set({ image: `img-${repo}` });
          }),
        }),
        (s) => s.continueOnItemFailure(),
      );
    }
    const b = new Batch();
    discoverTargets(b);
    const result = await execute(b, b.deployBatch, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);

    const runId = (await store.listRuns({}))[0].id;
    const loaded = await store.getRun(runId);
    if (loaded === null) throw new Error("expected the run record");
    const targets = loaded.record.targets;
    assertEquals(targets["deployBatch"].status, "failed");
    assertEquals(targets["deployBatch[a].deploy"].status, "succeeded");
    assertEquals(targets["deployBatch[a].deploy"].meta.image, "img-a");
    assertEquals(targets["deployBatch[b].deploy"].status, "failed");
  });
});

Deno.test("a throwing forEach items thunk fails the target, not the process", async () => {
  class Batch extends Build {
    deployBatch = target().forEach(
      () => {
        throw new Error("bad item list");
      },
      (_repo) => ({ deploy: target().executes(() => {}) }),
    );
  }
  // Both the sequential and the parallel dispatch paths must settle to a failed
  // result — never escape as an uncaught rejection.
  for (const parallel of [false, true]) {
    const b = new Batch();
    discoverTargets(b);
    const result = await execute(b, b.deployBatch, { silent: true, parallel });
    assertEquals(result.ok, false);
  }
});

Deno.test("a throwing forEach items thunk settles the run record to failed", async () => {
  await withStore(async (store) => {
    class Batch extends Build {
      deployBatch = target().forEach(
        () => {
          throw new Error("boom list");
        },
        (_repo) => ({ deploy: target().executes(() => {}) }),
      );
    }
    const b = new Batch();
    discoverTargets(b);
    const result = await execute(b, b.deployBatch, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.ok, false);
    const runId = (await store.listRuns({}))[0].id;
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "failed"); // settled, not stuck running
    assertEquals(loaded?.record.targets["deployBatch"].status, "failed");
  });
});

Deno.test("--list and graph annotate a fan-out target", () => {
  class Batch extends Build {
    plain = target().description("plain").executes(() => {});
    deployBatch = target().description("batch").forEach(
      () => ["a"],
      (_repo) => ({ deploy: target().executes(() => {}) }),
    );
  }
  const targets = discoverTargets(new Batch());
  const list = formatList(targets);
  assertStringIncludes(list, "deployBatch");
  assertStringIncludes(list, "[fan-out]");
  // The annotation is on the fan-out target, not the plain one.
  assertEquals(
    list.split("\n").find((l) => l.includes("plain"))?.includes(
      "[fan-out]",
    ),
    false,
  );
  assertStringIncludes(formatGraph(targets), "[fan-out]");
});

// --- parameter polish shipped with M4: per-element options + number arrays ---

/** Resolve one parameter from a CLI value and return it, for the array tests. */
async function resolved<T>(
  make: () => { value: T; name_?: string },
  cli: Record<string, string>,
): Promise<{ value: T }> {
  const build = { p: make() };
  const params = discoverParameters(build);
  const errors = await resolveParameters(params, cli, () => undefined);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return build.p;
}

Deno.test("array().options() validates every element", async () => {
  const ok = await resolved(
    () => parameter("svc").options("api", "web").array(),
    { p: "api,web" },
  );
  assertEquals(ok.value, ["api", "web"]);

  let rejected = false;
  try {
    await resolved(
      () => parameter("svc").options("api", "web").array(),
      { p: "api,nope" },
    );
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

Deno.test("number().array() parses a numeric list", async () => {
  const nums = await resolved(
    () => parameter("workers").number().array(),
    { p: "1,2,3" },
  );
  assertEquals(nums.value, [1, 2, 3]);

  let rejected = false;
  try {
    await resolved(() => parameter("workers").number().array(), { p: "1,x" });
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
