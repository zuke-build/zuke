import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build } from "../src/build.ts";
import { formatRunDetail, formatRunList, runsCommand } from "../src/runs.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";

/** A trivial build; `runsCommand` only reads `build.stateStore()` from it. */
class B extends Build {}

/** Run `fn` with `console.log`/`console.error` captured instead of printed. */
async function capture(
  fn: () => Promise<number> | number,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    const code = await fn();
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
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

/** A minimal valid run record. */
function sampleRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? "run-1",
    build: overrides.build ?? "CI",
    rootTarget: overrides.rootTarget ?? "deploy",
    status: overrides.status ?? "succeeded",
    actor: overrides.actor ?? "alice",
    createdAt: overrides.createdAt ?? "2026-07-17T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-17T10:05:00.000Z",
    graph: overrides.graph ?? [{ name: "deploy", dependsOn: [] }],
    params: overrides.params ?? {},
    targets: overrides.targets ?? { deploy: { status: "succeeded", meta: {} } },
    signals: overrides.signals ?? {},
    events: overrides.events ?? [],
  };
}

Deno.test("formatRunList renders headers and one row per run", () => {
  const text = formatRunList([
    {
      id: "run-9",
      build: "CI",
      rootTarget: "promote",
      status: "failed",
      actor: "bob",
      createdAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:01:00.000Z",
    },
  ]);
  assertStringIncludes(text, "ID");
  assertStringIncludes(text, "STATUS");
  assertStringIncludes(text, "run-9");
  assertStringIncludes(text, "failed");
  assertStringIncludes(text, "promote");
});

Deno.test("formatRunList reports an empty listing", () => {
  assertEquals(formatRunList([]), "No runs found.");
});

Deno.test("formatRunDetail shows header, params, targets, and signals", () => {
  const record = sampleRecord({
    status: "failed",
    params: { env: "sit", repo: "expense-service" },
    targets: {
      deploy: {
        status: "succeeded",
        meta: {},
        startedAt: "2026-07-17T10:00:00.000Z",
        endedAt: "2026-07-17T10:00:02.000Z",
      },
      gate: {
        status: "waiting",
        meta: {},
        waitingFor: {
          trigger: "signal:approved",
          deadline: "2026-07-19T10:00:00.000Z",
          onTimeout: "fail",
        },
      },
      promote: {
        status: "failed",
        meta: {},
        error: "Error: boom",
      },
      cleanup: { status: "pending", meta: {} },
      // Reversed timestamps: the duration is dropped rather than shown negative.
      weird: {
        status: "succeeded",
        meta: {},
        startedAt: "2026-07-17T10:00:05.000Z",
        endedAt: "2026-07-17T10:00:00.000Z",
      },
    },
    signals: {
      approved: { data: { by: "qa" }, receivedAt: "2026-07-18T09:00:00.000Z" },
    },
  });
  const text = formatRunDetail(record);
  assertStringIncludes(text, "Run run-1");
  assertStringIncludes(text, "status:   failed");
  assertStringIncludes(text, "Parameters:");
  assertStringIncludes(text, "env = sit");
  assertStringIncludes(text, "Targets:");
  assertStringIncludes(text, "deploy");
  assertStringIncludes(text, "waiting for signal:approved");
  assertStringIncludes(text, "deadline 2026-07-19T10:00:00.000Z");
  assertStringIncludes(text, "Error: boom");
  assertStringIncludes(text, "Signals:");
  assertStringIncludes(text, "approved");
});

Deno.test("formatRunDetail handles no params, no signals, no targets", () => {
  const text = formatRunDetail(sampleRecord({ targets: {} }));
  assertEquals(text.includes("Parameters:"), false);
  assertEquals(text.includes("Signals:"), false);
  assertStringIncludes(text, "(none recorded)");
});

Deno.test("formatRunDetail renders a waiting target without a deadline", () => {
  const text = formatRunDetail(sampleRecord({
    status: "suspended",
    targets: {
      gate: {
        status: "waiting",
        meta: {},
        waitingFor: { trigger: "predicate", onTimeout: "fail" },
      },
    },
  }));
  assertStringIncludes(text, "waiting for predicate");
  assertEquals(text.includes("deadline"), false);
});

Deno.test("runsCommand list prints seeded runs and defaults to list", async () => {
  await withStore(async (store) => {
    await store.putRun(sampleRecord({ id: "run-a" }), null);
    await store.putRun(sampleRecord({ id: "run-b", actor: "bob" }), null);
    // No action given → defaults to `list`.
    const { code, out } = await capture(() =>
      runsCommand(new B(), { stateStore: store })
    );
    assertEquals(code, 0);
    assertStringIncludes(out, "run-a");
    assertStringIncludes(out, "run-b");
  });
});

Deno.test("runsCommand list --json emits a summary array", async () => {
  await withStore(async (store) => {
    await store.putRun(sampleRecord({ id: "run-a" }), null);
    const { code, out } = await capture(() =>
      runsCommand(new B(), { action: "list", json: true, stateStore: store })
    );
    assertEquals(code, 0);
    const summaries = JSON.parse(out);
    assertEquals(Array.isArray(summaries), true);
    assertEquals(summaries[0].id, "run-a");
  });
});

Deno.test("runsCommand list applies a status filter", async () => {
  await withStore(async (store) => {
    await store.putRun(sampleRecord({ id: "ok", status: "succeeded" }), null);
    await store.putRun(sampleRecord({ id: "bad", status: "failed" }), null);
    const { code, out } = await capture(() =>
      runsCommand(new B(), {
        action: "list",
        query: { status: "failed" },
        stateStore: store,
      })
    );
    assertEquals(code, 0);
    assertStringIncludes(out, "bad");
    assertEquals(out.includes("ok "), false);
  });
});

Deno.test("runsCommand show prints one run's detail, and --json its record", async () => {
  await withStore(async (store) => {
    await store.putRun(sampleRecord({ id: "run-x" }), null);

    const human = await capture(() =>
      runsCommand(new B(), {
        action: "show",
        runId: "run-x",
        stateStore: store,
      })
    );
    assertEquals(human.code, 0);
    assertStringIncludes(human.out, "Run run-x");
    assertStringIncludes(human.out, "Targets:");

    const json = await capture(() =>
      runsCommand(new B(), {
        action: "show",
        runId: "run-x",
        json: true,
        stateStore: store,
      })
    );
    assertEquals(json.code, 0);
    const record = JSON.parse(json.out);
    assertEquals(record.id, "run-x");
    assertEquals(record.targets.deploy.status, "succeeded");
  });
});

Deno.test("runsCommand show without an id is a usage error", async () => {
  await withStore(async (store) => {
    const { code, err } = await capture(() =>
      runsCommand(new B(), { action: "show", stateStore: store })
    );
    assertEquals(code, 1);
    assertStringIncludes(err, "Usage: zuke runs show");
  });
});

Deno.test("runsCommand show reports an unknown run id", async () => {
  await withStore(async (store) => {
    const { code, err } = await capture(() =>
      runsCommand(new B(), { action: "show", runId: "nope", stateStore: store })
    );
    assertEquals(code, 1);
    assertStringIncludes(err, 'no run "nope"');
  });
});

Deno.test("runsCommand resolves the store from ZUKE_STATE_DIR", async () => {
  const dir = await Deno.makeTempDir();
  const prev = Deno.env.get("ZUKE_STATE_DIR");
  Deno.env.set("ZUKE_STATE_DIR", `${dir}/runs`);
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    await store.putRun(sampleRecord({ id: "env-run" }), null);
    // No explicit store or readEnv → resolves from the environment.
    const { code, out } = await capture(() =>
      runsCommand(new B(), { action: "list" })
    );
    assertEquals(code, 0);
    assertStringIncludes(out, "env-run");
  } finally {
    if (prev === undefined) Deno.env.delete("ZUKE_STATE_DIR");
    else Deno.env.set("ZUKE_STATE_DIR", prev);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runsCommand errors with no store configured", async () => {
  const { code, err } = await capture(() =>
    runsCommand(new B(), { action: "list", stateStore: false })
  );
  assertEquals(code, 1);
  assertStringIncludes(err, "no state store is configured");
});

Deno.test("runsCommand rejects an unknown sub-action", async () => {
  await withStore(async (store) => {
    const { code, err } = await capture(() =>
      runsCommand(new B(), { action: "delete", stateStore: store })
    );
    assertEquals(code, 1);
    assertStringIncludes(err, "Usage: zuke runs <list|show>");
  });
});
