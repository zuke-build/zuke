// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The store-backed MCP run tools driven end-to-end: `list_runs` filters,
 * `show_run`'s full record, and `signal_run`/`resume_check`/`cancel_run`
 * advancing **real suspended runs** (created by `execute` suspending at a
 * `waitsFor` gate). Typed failures — a lost resume race, a lock conflict, a
 * failing resumed target, a store fault mid-operation — must come back as
 * structured JSON tool results the client can act on, never as flattened
 * strings or transport crashes.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target, type TargetBuilder } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import { externalSignal } from "../src/wait.ts";
import { McpServer } from "../src/mcp/server.ts";
import { callRunStateTool, type RunToolDeps } from "../src/mcp/runtools.ts";
import { acquireLease, RUN_LEASE_PREFIX } from "../src/state/run_lease.ts";
import { LockConflictError } from "../src/state/lock.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import {
  defaultStateHost,
  type StateStore,
  type StateStoreScope,
} from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";

/** A JSON-RPC request with id 1. */
function req(method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}

/** The `{ text, isError }` of a `tools/call` result (no casts). */
function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Call a tool through the server and return its text block. */
async function call(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const res = await server.handleMessage(
    req("tools/call", { name, arguments: args }),
  );
  if (!isRec(res) || !isRec(res.result)) {
    throw new Error(`expected a result: ${JSON.stringify(res)}`);
  }
  const content = res.result.content;
  if (
    !Array.isArray(content) || !isRec(content[0]) ||
    typeof content[0].text !== "string"
  ) {
    throw new Error("not a tool result");
  }
  return { text: content[0].text, isError: res.result.isError === true };
}

/** Run `fn` with a real temp-dir store, cleaned up afterwards. */
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

/** Execute `root` until it suspends at its gate, returning the run id. */
async function suspend(
  build: Build,
  root: TargetBuilder,
  store: StateStore,
): Promise<string> {
  const result = await execute(build, root, {
    silent: true,
    stateStore: store,
    readEnv: () => undefined,
  });
  if (result.suspended !== true || result.runId === undefined) {
    throw new Error("fixture did not suspend");
  }
  return result.runId;
}

/** A pipeline suspending at an `approved` gate, recording the signal payload. */
function makePipeline(): { build: Build; root: TargetBuilder; seen: unknown[] } {
  const seen: unknown[] = [];
  class Pipeline extends Build {
    gate = target().description("Gate")
      .waitsFor((s) => s.on(externalSignal("approved")));
    promote = target().dependsOn(this.gate).executes((ctx) => {
      seen.push(ctx.signals.get("approved")?.data ?? null);
    });
  }
  const build = new Pipeline();
  discoverTargets(build);
  return { build, root: build.promote, seen };
}

/** Persist a run record directly (for filter tests), returning its id. */
async function seedRun(
  store: StateStore,
  id: string,
  rootTarget: string,
  status: "suspended" | "failed",
  createdAt: string,
): Promise<string> {
  const record: RunRecord = {
    id,
    build: "Pipeline",
    rootTarget,
    status,
    actor: "someone",
    createdAt,
    updatedAt: createdAt,
    graph: [{ name: rootTarget, dependsOn: [] }],
    params: {},
    targets: { [rootTarget]: { status: "waiting", meta: {} } },
    signals: {},
    events: [],
  };
  const put = await store.putRun(record, null);
  if (!put.ok) throw new Error("failed to seed run");
  return id;
}

Deno.test("list_runs filters by status, target, and since; an unknown status is refused", async () => {
  await withStore(async (store) => {
    const { build } = makePipeline();
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    await seedRun(store, "run-old", "deploy", "suspended", "2026-01-01T00:00:00.000Z");
    await seedRun(store, "run-new", "promote", "failed", "2026-06-01T00:00:00.000Z");

    const byStatus = await call(server, "list_runs", { status: "failed" });
    assertEquals(byStatus.isError, false);
    assertEquals(JSON.parse(byStatus.text).map((r: { id: string }) => r.id), [
      "run-new",
    ]);

    const byTarget = await call(server, "list_runs", { target: "deploy" });
    assertEquals(JSON.parse(byTarget.text).map((r: { id: string }) => r.id), [
      "run-old",
    ]);

    const since = await call(server, "list_runs", {
      since: "2026-03-01T00:00:00.000Z",
    });
    assertEquals(JSON.parse(since.text).map((r: { id: string }) => r.id), [
      "run-new",
    ]);

    // An unknown status is a structured refusal naming the allowed values.
    const bad = await call(server, "list_runs", { status: "bogus" });
    assertEquals(bad.isError, true);
    const body = JSON.parse(bad.text);
    assertEquals(body.error, "invalid_status");
    assertEquals(body.status, "bogus");
    assertEquals(body.allowed.includes("suspended"), true);
  });
});

Deno.test("show_run returns the full record; a missing runId is a structured error", async () => {
  await withStore(async (store) => {
    const { build } = makePipeline();
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    await seedRun(store, "run-a", "promote", "suspended", "2026-01-01T00:00:00.000Z");

    const shown = await call(server, "show_run", { runId: "run-a" });
    assertEquals(shown.isError, false);
    const record = JSON.parse(shown.text);
    assertEquals(record.id, "run-a");
    assertEquals(record.rootTarget, "promote");
    assertEquals(record.status, "suspended");
    assertEquals(record.targets.promote.status, "waiting");

    // Each tool taking runId reports the missing argument the same way.
    for (const tool of ["show_run", "signal_run", "cancel_run"]) {
      const missing = await call(server, tool);
      assertEquals(missing.isError, true, `${tool} did not error`);
      const body = JSON.parse(missing.text);
      assertEquals(body.error, "missing_argument");
      assertEquals(body.argument, "runId");
    }
  });
});

Deno.test("signal_run delivers the payload and resumes the run to completion", async () => {
  await withStore(async (store) => {
    const { build, root, seen } = makePipeline();
    const server = new McpServer(build, {
      allowRun: true,
      stateStore: store,
      actor: "op",
    });
    const runId = await suspend(build, root, store);

    const result = await call(server, "signal_run", {
      runId,
      signal: "approved",
      data: { by: "qa" },
    });
    assertEquals(result.isError, false);
    const body = JSON.parse(result.text);
    assertEquals(body.ok, true);
    assertEquals(body.runId, runId);
    assertEquals(body.suspended, false);
    assertEquals(body.executed.includes("promote"), true);
    // The resumed target saw the delivered payload…
    assertEquals(seen, [{ by: "qa" }]);
    // …and the durable record settled.
    const loaded = await store.getRun(runId);
    assertEquals(loaded?.record.status, "succeeded");
  });
});

Deno.test("signal_run with no satisfying signal re-suspends and reports it", async () => {
  await withStore(async (store) => {
    const { build, root, seen } = makePipeline();
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    const runId = await suspend(build, root, store);

    // No signal delivered: the gate stays unsatisfied and the run parks again.
    const result = await call(server, "signal_run", { runId });
    assertEquals(result.isError, false);
    const body = JSON.parse(result.text);
    assertEquals(body.ok, true);
    assertEquals(body.suspended, true);
    assertEquals(seen, []);
    assertEquals((await store.getRun(runId))?.record.status, "suspended");
  });
});

Deno.test("a lost resume race is a structured already_resumed, not a crash", async () => {
  await withStore(async (store) => {
    const { build, root } = makePipeline();
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    const runId = await suspend(build, root, store);

    // A rival process holds the run's lease, so this resumer must lose.
    const lease = await acquireLease(
      store,
      RUN_LEASE_PREFIX,
      runId,
      "rival",
      () => new Date().toISOString(),
    );
    if (lease === null) throw new Error("fixture could not take the lease");
    try {
      const result = await call(server, "signal_run", {
        runId,
        signal: "approved",
      });
      assertEquals(result.isError, true);
      const body = JSON.parse(result.text);
      assertEquals(body.error, "already_resumed");
      assertEquals(body.runId, runId);
      // Who has it, and since when, are part of the structured answer.
      assertEquals(typeof body.by, "string");
      assertEquals(typeof body.at, "string");
    } finally {
      await lease.release();
    }
  });
});

Deno.test("a lock conflict in the resumed run surfaces as structured lock_conflict", async () => {
  await withStore(async (store) => {
    const seenHolder = {
      actor: "rival",
      runId: "run-elsewhere",
      since: "2026-01-01T00:00:00.000Z",
    };
    class Locked extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("approved")));
      promote = target().dependsOn(this.gate).executes(() => {
        throw new LockConflictError(
          seenHolder,
          "deploy lock is held by rival — cancel run-elsewhere to release it",
        );
      });
    }
    const build = new Locked();
    discoverTargets(build);
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    const runId = await suspend(build, build.promote, store);

    const result = await call(server, "signal_run", {
      runId,
      signal: "approved",
    });
    assertEquals(result.isError, true);
    const body = JSON.parse(result.text);
    assertEquals(body.error, "lock_conflict");
    assertEquals(body.holder, seenHolder);
    assertStringIncludes(body.guidance, "cancel run-elsewhere");
  });
});

Deno.test("a failing resumed target is a structured run_failed with the message", async () => {
  await withStore(async (store) => {
    class Failing extends Build {
      gate = target().waitsFor((s) => s.on(externalSignal("approved")));
      promote = target().dependsOn(this.gate).executes(() => {
        throw new Error("promotion exploded");
      });
    }
    const build = new Failing();
    discoverTargets(build);
    const server = new McpServer(build, { allowRun: true, stateStore: store });
    const runId = await suspend(build, build.promote, store);

    const result = await call(server, "signal_run", {
      runId,
      signal: "approved",
    });
    assertEquals(result.isError, true);
    const body = JSON.parse(result.text);
    assertEquals(body.error, "run_failed");
    assertEquals(body.runId, runId);
    assertStringIncludes(body.message, "promotion exploded");
  });
});

Deno.test("resume_check re-checks one run, and a sweep covers every authorized run", async () => {
  await withStore(async (store) => {
    const { build, root } = makePipeline();
    const server = new McpServer(build, {
      allowRun: true,
      stateStore: store,
      actor: "op",
    });
    const runId = await suspend(build, root, store);

    // A single-run check: the signal gate is unsatisfied, so it re-suspends —
    // checked but not failed.
    const single = await call(server, "resume_check", { runId });
    assertEquals(single.isError, false);
    assertEquals(JSON.parse(single.text), { ok: true, checked: 1, failed: 0 });
    assertEquals((await store.getRun(runId))?.record.status, "suspended");

    // A sweep (no runId) finds and checks the same suspended run.
    const sweep = await call(server, "resume_check");
    assertEquals(sweep.isError, false);
    assertEquals(JSON.parse(sweep.text), { ok: true, checked: 1, failed: 0 });

    // A single-run check of a missing run is a structured no_run.
    const missing = await call(server, "resume_check", { runId: "nope" });
    assertEquals(missing.isError, true);
    assertEquals(JSON.parse(missing.text).error, "no_run");
  });
});

Deno.test("a resume_check failure on one run is reported as structured run_failed", async () => {
  await withStore(async (store) => {
    const { build, root } = makePipeline();
    const runId = await suspend(build, root, store);
    // A dependency failure inside the check itself (here: the environment
    // backend erroring mid-sweep) must come back as a structured per-run
    // failure naming the run, not reject the whole tool call.
    const deps: RunToolDeps = {
      store,
      build,
      actor: "op",
      readEnv: () => {
        throw new Error("env backend offline");
      },
      authorize: () => null,
    };
    const result = await callRunStateTool(deps, "resume_check", { runId });
    assertEquals(result?.isError, true);
    const body = JSON.parse(result?.text ?? "{}");
    assertEquals(body.error, "run_failed");
    assertEquals(body.runId, runId);
    assertStringIncludes(body.message, "env backend offline");
  });
});

/** Delegates to a real store, but `getRun` fails after the first read. */
class FlakyStore implements StateStore {
  #reads = 0;
  constructor(private readonly inner: StateStore) {}
  getRun(id: string): ReturnType<StateStore["getRun"]> {
    this.#reads += 1;
    if (this.#reads > 1) {
      return Promise.reject(new Error("state backend offline"));
    }
    return this.inner.getRun(id);
  }
  putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): ReturnType<StateStore["putRun"]> {
    return this.inner.putRun(record, expectedVersion);
  }
  listRuns(
    query: Parameters<StateStore["listRuns"]>[0],
  ): ReturnType<StateStore["listRuns"]> {
    return this.inner.listRuns(query);
  }
  deleteRun(id: string): Promise<void> {
    return this.inner.deleteRun(id);
  }
  acquireLock(
    key: string,
    holder: Parameters<StateStore["acquireLock"]>[1],
    ttlMs: number,
  ): ReturnType<StateStore["acquireLock"]> {
    return this.inner.acquireLock(key, holder, ttlMs);
  }
  renewLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    return this.inner.renewLock(key, token, ttlMs);
  }
  releaseLock(key: string, token: string): Promise<void> {
    return this.inner.releaseLock(key, token);
  }
}

Deno.test("a store fault mid-cancel is a structured run_failed, not a crash", async () => {
  await withStore(async (inner) => {
    const { build } = makePipeline();
    await seedRun(inner, "run-x", "promote", "suspended", "2026-01-01T00:00:00.000Z");
    // The tool's own pre-check read succeeds; the store then dies underneath
    // cancelRun. The caller still gets structured JSON naming the run.
    const flaky = new FlakyStore(inner);
    const server = new McpServer(build, { allowRun: true, stateStore: flaky });
    const result = await call(server, "cancel_run", { runId: "run-x" });
    assertEquals(result.isError, true);
    const body = JSON.parse(result.text);
    assertEquals(body.error, "run_failed");
    assertEquals(body.runId, "run-x");
    assertStringIncludes(body.message, "state backend offline");
  });
});
