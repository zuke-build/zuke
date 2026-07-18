import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "./_assert.ts";
import {
  parseRunRecord,
  parseRunSummary,
  type RunRecord,
  stringifyRunRecord,
  toSummary,
} from "../src/state/types.ts";
import {
  defaultStateHost,
  type StateHost,
  type StateStore,
} from "../src/state/store.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { HttpStateStore } from "../src/state/http_store.ts";
import { envStateStore, resolveStateStore } from "../src/state/resolve.ts";
import { HttpError } from "../src/http.ts";
import {
  buildRunRecord,
  recordStatusOf,
  resolveActor,
} from "../src/state/record.ts";
import { inMemoryStateHandle, RunStateWriter } from "../src/state/writer.ts";
import { Redactor } from "../src/redact.ts";
import { LockSettings, target } from "../src/target.ts";
import { externalSignal, resumeWhen } from "../src/wait.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { discoverParameters, parameter } from "../src/params.ts";
import { parseDuration } from "../src/duration.ts";
import {
  LockConflictError,
  lockKey,
  parseLockHolder,
  parseLockRecord,
  stringifyLockRecord,
} from "../src/state/lock.ts";

/** A minimal, valid run record for tests. */
function sampleRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? "run-1",
    build: overrides.build ?? "CI",
    rootTarget: overrides.rootTarget ?? "deploy",
    status: overrides.status ?? "running",
    actor: overrides.actor ?? "alice",
    createdAt: overrides.createdAt ?? "2026-07-17T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-17T10:00:00.000Z",
    graph: overrides.graph ?? [{ name: "deploy", dependsOn: [] }],
    params: overrides.params ?? { env: "sit" },
    targets: overrides.targets ??
      { deploy: { status: "pending", meta: {} } },
    signals: overrides.signals ?? {},
    events: overrides.events ?? [],
  };
}

/** An in-memory {@link StateHost}: a flat file map plus a lock set. */
class FakeStateHost implements StateHost {
  readonly files = new Map<string, string>();
  readonly locks = new Set<string>();

  readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
    }
    return Promise.resolve();
  }
  createExclusive(path: string): Promise<boolean> {
    if (this.locks.has(path)) return Promise.resolve(false);
    this.locks.add(path);
    return Promise.resolve(true);
  }
  remove(path: string): Promise<void> {
    this.files.delete(path);
    this.locks.delete(path);
    return Promise.resolve();
  }
  listDir(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const names: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
    }
    return Promise.resolve(names);
  }
  mkdirp(): Promise<void> {
    return Promise.resolve();
  }
  /** A controllable clock for lock-TTL tests; advance it with `time`. */
  time = 1_000_000;
  now(): number {
    return this.time;
  }
}

// ---------------------------------------------------------------- types

Deno.test("stringify then parse round-trips a run record", () => {
  const record = sampleRecord();
  assertEquals(parseRunRecord(stringifyRunRecord(record)), record);
});

Deno.test("toSummary projects a record's summary fields", () => {
  assertEquals(toSummary(sampleRecord({ id: "r9" })), {
    id: "r9",
    build: "CI",
    rootTarget: "deploy",
    status: "running",
    actor: "alice",
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
  });
});

Deno.test("parseRunRecord rejects malformed records", () => {
  const cases: Array<[string, string]> = [
    ["not json", "not valid JSON"],
    ["42", "not an object"],
    [JSON.stringify({ ...sampleRecord(), id: 1 }), 'field "id"'],
    [
      JSON.stringify({ ...sampleRecord(), status: "weird" }),
      "unknown run status",
    ],
    [
      JSON.stringify({ ...sampleRecord(), graph: "x" }),
      '"graph" is not an array',
    ],
    [
      JSON.stringify({ ...sampleRecord(), graph: [1] }),
      "graph node is not an object",
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        graph: [{ name: "a", dependsOn: [1] }],
      }),
      "not a string array",
    ],
    [
      JSON.stringify({ ...sampleRecord(), params: "x" }),
      '"params" is not an object',
    ],
    [
      JSON.stringify({ ...sampleRecord(), params: { a: 1 } }),
      'param "a" is not a string',
    ],
    [
      JSON.stringify({ ...sampleRecord(), targets: "x" }),
      '"targets" is not an object',
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: { a: { status: "bogus", meta: {} } },
      }),
      "unknown target status",
    ],
    [
      JSON.stringify({ ...sampleRecord(), targets: { a: 5 } }),
      "target state is not an object",
    ],
    [
      JSON.stringify({ ...sampleRecord(), signals: "x" }),
      '"signals" is not an object',
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: {
          a: {
            status: "waiting",
            meta: {},
            waitingFor: { trigger: "signal:x", onTimeout: "bogus" },
          },
        },
      }),
      "invalid wait onTimeout disposition",
    ],
  ];
  for (const [text, needle] of cases) {
    assertThrows(() => parseRunRecord(text), Error, needle);
  }
});

Deno.test("parseRunRecord round-trips signals and a waiting target", () => {
  const record = sampleRecord({
    status: "suspended",
    signals: {
      approved: { data: { by: "qa" }, receivedAt: "2026-07-17T10:00:00.000Z" },
    },
    targets: {
      gate: {
        status: "waiting",
        meta: {},
        waitingFor: {
          trigger: "signal:approved",
          deadline: "2026-07-20T10:00:00.000Z",
          onTimeout: { target: "rollback" },
        },
      },
    },
  });
  assertEquals(parseRunRecord(stringifyRunRecord(record)), record);
});

Deno.test("parseRunRecord defaults missing signals to empty (backwards compat)", () => {
  const { signals: _signals, ...withoutSignals } = sampleRecord();
  assertEquals(parseRunRecord(JSON.stringify(withoutSignals)).signals, {});
});

Deno.test("externalSignal is satisfied only when the named signal is present", async () => {
  const trigger = externalSignal("approved");
  assertEquals(trigger.descriptor, "signal:approved");
  assertEquals(await trigger.isSatisfied(new Map()), false);
  assertEquals(
    await trigger.isSatisfied(
      new Map([["approved", { data: {}, receivedAt: "t" }]]),
    ),
    true,
  );
});

Deno.test("resumeWhen evaluates the predicate and carries a poll interval", async () => {
  assertEquals(await resumeWhen(() => true).isSatisfied(new Map()), true);
  assertEquals(await resumeWhen(() => false).isSatisfied(new Map()), false);
  assertEquals(
    resumeWhen(() => true, { interval: "30s" }).pollIntervalMs,
    30_000,
  );
  assertEquals(resumeWhen(() => true).pollIntervalMs, undefined);
});

Deno.test("parseRunRecord preserves nested target meta as JSON", () => {
  const record = sampleRecord({
    targets: {
      deploy: {
        status: "succeeded",
        meta: {
          at: "sit-7",
          tries: 2,
          ok: true,
          tags: ["a"],
          extra: { n: null },
        },
        startedAt: "2026-07-17T10:00:01.000Z",
        endedAt: "2026-07-17T10:00:02.000Z",
      },
    },
  });
  assertEquals(parseRunRecord(stringifyRunRecord(record)), record);
});

Deno.test("parseRunSummary validates untrusted summaries", () => {
  const good = toSummary(sampleRecord());
  assertEquals(parseRunSummary(good), good);
  assertThrows(() => parseRunSummary(5), Error, "not an object");
  assertThrows(
    () => parseRunSummary({ ...good, status: "nope" }),
    Error,
    "unknown run status",
  );
});

// ---------------------------------------------------------------- fs store

Deno.test("FileSystemStateStore persists and reconstructs a record", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/runs", host);
  assertEquals(await store.getRun("run-1"), null);

  const created = await store.putRun(sampleRecord(), null);
  assertEquals(created.ok, true);

  const loaded = await store.getRun("run-1");
  assertEquals(loaded?.record, sampleRecord());
  assertEquals(typeof loaded?.version, "string");
});

Deno.test("FileSystemStateStore CAS rejects a stale write", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/runs", host);
  const created = await store.putRun(sampleRecord(), null);
  if (!created.ok) throw new Error("expected create to succeed");

  // A second create at the same (null) expectation loses: the record exists.
  const stale = await store.putRun(sampleRecord({ actor: "bob" }), null);
  assertEquals(stale, { ok: false, conflict: true });

  // Writing at the current version succeeds and moves the version on.
  const updated = await store.putRun(
    sampleRecord({ status: "succeeded" }),
    created.version,
  );
  assertEquals(updated.ok, true);
  // The old version no longer matches.
  const conflict = await store.putRun(sampleRecord(), created.version);
  assertEquals(conflict, { ok: false, conflict: true });
});

Deno.test("FileSystemStateStore: concurrent writers — exactly one wins", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/runs", host);
  const created = await store.putRun(sampleRecord(), null);
  if (!created.ok) throw new Error("expected create to succeed");

  const results = await Promise.all([
    store.putRun(sampleRecord({ actor: "b" }), created.version),
    store.putRun(sampleRecord({ actor: "c" }), created.version),
  ]);
  const wins = results.filter((r) => r.ok).length;
  const conflicts = results.filter((r) => !r.ok).length;
  assertEquals(wins, 1);
  assertEquals(conflicts, 1);
});

Deno.test("FileSystemStateStore listRuns filters, sorts, and skips junk", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/runs", host);
  await store.putRun(
    sampleRecord({ id: "r1", createdAt: "2026-01-01T00:00:00.000Z" }),
    null,
  );
  await store.putRun(
    sampleRecord({
      id: "r2",
      createdAt: "2026-02-01T00:00:00.000Z",
      status: "failed",
    }),
    null,
  );
  await store.putRun(
    sampleRecord({
      id: "r3",
      createdAt: "2026-03-01T00:00:00.000Z",
      graph: [{ name: "other", dependsOn: [] }],
    }),
    null,
  );
  // Junk files that must be ignored.
  host.files.set("/runs/broken.json", "not json");
  host.files.set("/runs/note.txt", "ignored");

  const all = await store.listRuns({});
  assertEquals(all.map((s) => s.id), ["r3", "r2", "r1"]); // newest first

  assertEquals((await store.listRuns({ status: "failed" })).map((s) => s.id), [
    "r2",
  ]);
  assertEquals((await store.listRuns({ target: "other" })).map((s) => s.id), [
    "r3",
  ]);
  assertEquals(
    (await store.listRuns({ since: "2026-02-15T00:00:00.000Z" })).map((s) =>
      s.id
    ),
    ["r3"],
  );
});

Deno.test("FileSystemStateStore rejects an unsafe run id on read and write", async () => {
  const store = new FileSystemStateStore("/runs", new FakeStateHost());
  await assertRejects(() => store.getRun("../escape"), Error, "unsafe run id");
  await assertRejects(
    () => store.putRun(sampleRecord({ id: "../escape" }), null),
    Error,
    "unsafe run id",
  );
});

Deno.test("FileSystemStateStore round-trips through the real filesystem", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const created = await store.putRun(sampleRecord(), null);
    if (!created.ok) throw new Error("expected create to succeed");
    const loaded = await store.getRun("run-1");
    assertEquals(loaded?.record.actor, "alice");
    assertEquals((await store.listRuns({})).length, 1);
    // Concurrent writers against the real O_EXCL lock: exactly one wins.
    const results = await Promise.all([
      store.putRun(sampleRecord({ actor: "b" }), created.version),
      store.putRun(sampleRecord({ actor: "c" }), created.version),
    ]);
    assertEquals(results.filter((r) => r.ok).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------- http store

/** A fetch double answering from a handler. */
function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init));
}

Deno.test("HttpStateStore.getRun returns record + ETag, or null on 404", async () => {
  const store = new HttpStateStore({
    url: "https://s.example/",
    token: "t",
    fetch: fakeFetch((url, init) => {
      assertEquals(init?.headers, { Authorization: "Bearer t" });
      if (url.endsWith("/runs/missing")) {
        return new Response(null, { status: 404 });
      }
      return new Response(stringifyRunRecord(sampleRecord()), {
        status: 200,
        headers: { etag: "v1" },
      });
    }),
  });
  const loaded = await store.getRun("run-1");
  assertEquals(loaded?.version, "v1");
  assertEquals(loaded?.record.id, "run-1");
  assertEquals(await store.getRun("missing"), null);
});

Deno.test("HttpStateStore.getRun errors without an ETag or on failure", async () => {
  const noEtag = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() =>
      new Response(stringifyRunRecord(sampleRecord()), { status: 200 })
    ),
  });
  await assertRejects(
    () => noEtag.getRun("run-1"),
    Error,
    "did not return an ETag",
  );

  const boom = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => boom.getRun("run-1"), HttpError);
});

Deno.test("HttpStateStore.putRun sends preconditions and maps 412 to a conflict", async () => {
  const seen: Array<Record<string, string>> = [];
  const store = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch((_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        ifMatch: headers.get("if-match") ?? "",
        ifNoneMatch: headers.get("if-none-match") ?? "",
      });
      if (headers.get("if-match") === "stale") {
        return new Response(null, { status: 412 });
      }
      return new Response(null, { status: 200, headers: { etag: "v2" } });
    }),
  });
  const created = await store.putRun(sampleRecord(), null);
  assertEquals(created, { ok: true, version: "v2" });
  assertEquals(seen[0].ifNoneMatch, "*");

  const updated = await store.putRun(sampleRecord(), "v1");
  assertEquals(updated, { ok: true, version: "v2" });
  assertEquals(seen[1].ifMatch, "v1");

  const conflict = await store.putRun(sampleRecord(), "stale");
  assertEquals(conflict, { ok: false, conflict: true });
});

Deno.test("HttpStateStore.putRun errors without an ETag or on failure", async () => {
  const noEtag = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 200 })),
  });
  await assertRejects(
    () => noEtag.putRun(sampleRecord(), null),
    Error,
    "did not return an ETag on write",
  );
  const boom = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => boom.putRun(sampleRecord(), null), HttpError);
});

Deno.test("HttpStateStore.listRuns builds a query and validates the array", async () => {
  let lastUrl = "";
  const store = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch((url) => {
      lastUrl = url;
      return new Response(JSON.stringify([toSummary(sampleRecord())]), {
        status: 200,
      });
    }),
  });
  const list = await store.listRuns({
    status: "running",
    target: "deploy",
    since: "x",
  });
  assertEquals(list.length, 1);
  assertStringIncludes(lastUrl, "status=running");
  assertStringIncludes(lastUrl, "target=deploy");

  const emptyQuery = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch((url) => {
      assertEquals(url, "https://s.example/runs");
      return new Response("{}", { status: 200 });
    }),
  });
  await assertRejects(
    () => emptyQuery.listRuns({}),
    Error,
    "did not return a JSON array",
  );

  const boom = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 503 })),
  });
  await assertRejects(() => boom.listRuns({}), HttpError);
});

// ---------------------------------------------------------------- resolve

Deno.test("resolveStateStore honours precedence", () => {
  const host = new FakeStateHost();
  const explicit = new FileSystemStateStore("/explicit", host);
  const declared = new FileSystemStateStore("/declared", host);
  const base = {
    host,
    defaultDir: "/root/.zuke/runs",
    enableDefault: false,
    readEnv: () => undefined,
  };

  assertEquals(resolveStateStore(false, declared, base), undefined);
  assertEquals(resolveStateStore(explicit, declared, base), explicit);
  assertEquals(resolveStateStore(undefined, declared, base), declared);
  assertEquals(resolveStateStore(undefined, undefined, base), undefined);
  // With no explicit/declared/env store, the default kicks in only when enabled.
  const def = resolveStateStore(undefined, undefined, {
    ...base,
    enableDefault: true,
  });
  assertEquals(def instanceof FileSystemStateStore, true);
});

Deno.test("envStateStore selects HTTP by URL then filesystem by DIR", () => {
  const host = new FakeStateHost();
  const url = envStateStore(
    (n) => (n === "ZUKE_STATE_URL" ? "https://s" : undefined),
    host,
  );
  assertEquals(url instanceof HttpStateStore, true);
  const dir = envStateStore(
    (n) => (n === "ZUKE_STATE_DIR" ? "/d" : undefined),
    host,
  );
  assertEquals(dir instanceof FileSystemStateStore, true);
  assertEquals(envStateStore(() => undefined, host), undefined);
});

// ---------------------------------------------------------------- record

Deno.test("recordStatusOf maps executor statuses onto record statuses", () => {
  assertEquals(recordStatusOf("passed"), "succeeded");
  assertEquals(recordStatusOf("cached"), "succeeded");
  assertEquals(recordStatusOf("failed"), "failed");
  assertEquals(recordStatusOf("skipped"), "skipped");
});

Deno.test("resolveActor prefers explicit, then env, then anonymous", () => {
  assertEquals(resolveActor("me", () => "env"), "me");
  assertEquals(
    resolveActor(undefined, (n) => (n === "ZUKE_ACTOR" ? "z" : undefined)),
    "z",
  );
  assertEquals(
    resolveActor(undefined, (n) => (n === "GITHUB_ACTOR" ? "gh" : undefined)),
    "gh",
  );
  assertEquals(resolveActor(undefined, () => undefined), "anonymous");
});

Deno.test("buildRunRecord snapshots the graph, seeds targets, excludes secrets", () => {
  class B extends Build {
    token = parameter("api token").secret();
    env = parameter("environment");
    optional = parameter("optional flag");
    clean = target().executes(() => {});
    deploy = target().dependsOn(this.clean).executes(() => {});
  }
  const build = new B();
  discoverTargets(build);
  const params = discoverParameters(build);
  build.token.resolve_("shh"); // secret → excluded
  build.env.resolve_("sit"); // non-secret, set → included
  // `optional` left unresolved → excluded (not set).

  const record = buildRunRecord({
    runId: "run-x",
    build: "B",
    rootTarget: "deploy",
    actor: "alice",
    now: "2026-07-17T10:00:00.000Z",
    order: [build.clean, build.deploy],
    params: params.values(),
  });
  assertEquals(record.graph, [
    { name: "clean", dependsOn: [] },
    { name: "deploy", dependsOn: ["clean"] },
  ]);
  assertEquals(record.targets, {
    clean: { status: "pending", meta: {} },
    deploy: { status: "pending", meta: {} },
  });
  assertEquals(record.status, "running");
  assertEquals(record.params, { env: "sit" }); // secret + unset excluded
});

// ---------------------------------------------------------------- writer

/** An in-memory {@link StateStore} with a bump counter version. */
class MemStore implements StateStore {
  record: RunRecord | null = null;
  version = 0;
  failNextPut = false;
  forceConflicts = 0;
  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getRun(): Promise<{ record: RunRecord; version: string } | null> {
    return Promise.resolve(
      this.record === null ? null : {
        record: structuredClone(this.record),
        version: String(this.version),
      },
    );
  }
  putRun(record: RunRecord, expected: string | null): Promise<
    { ok: true; version: string } | { ok: false; conflict: true }
  > {
    if (this.failNextPut) {
      this.failNextPut = false;
      return Promise.reject(new Error("store down"));
    }
    if (this.forceConflicts > 0) {
      this.forceConflicts -= 1;
      return Promise.resolve({ ok: false, conflict: true });
    }
    const current = this.record === null ? null : String(this.version);
    if (current !== expected) {
      return Promise.resolve({ ok: false, conflict: true });
    }
    this.record = structuredClone(record);
    this.version += 1;
    return Promise.resolve({ ok: true, version: String(this.version) });
  }
  // Locks are exercised against the real backends, not this run-only fake.
  acquireLock(): Promise<never> {
    throw new Error("MemStore: acquireLock is unused in these tests");
  }
  renewLock(): Promise<never> {
    throw new Error("MemStore: renewLock is unused in these tests");
  }
  releaseLock(): Promise<never> {
    throw new Error("MemStore: releaseLock is unused in these tests");
  }
}

Deno.test("RunStateWriter records transitions and redacted state", async () => {
  const store = new MemStore();
  const redactor = new Redactor();
  redactor.add("swordfish");
  const writer = await RunStateWriter.open(
    store,
    sampleRecord({ targets: { deploy: { status: "pending", meta: {} } } }),
    () => "2026-07-17T10:00:05.000Z",
    redactor,
  );
  await writer.markTargetRunning("deploy");
  await writer.stateHandle("deploy").set({
    where: "sit-7",
    token: "swordfish",
  });
  await writer.markTargetSettled("deploy", "passed");
  await writer.markRunFinished(true);

  const persisted = store.record;
  assertEquals(persisted?.status, "succeeded");
  assertEquals(persisted?.targets.deploy.status, "succeeded");
  assertEquals(persisted?.targets.deploy.startedAt, "2026-07-17T10:00:05.000Z");
  assertEquals(persisted?.targets.deploy.meta.where, "sit-7");
  assertEquals(persisted?.targets.deploy.meta.token, "[redacted]"); // secret masked
  assertEquals(writer.stateHandle("deploy").get().where, "sit-7");
});

Deno.test("RunStateWriter records a failure message, redacted", async () => {
  const store = new MemStore();
  const redactor = new Redactor();
  redactor.add("hunter2");
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    redactor,
  );
  await writer.markTargetSettled("deploy", "failed", "bad password hunter2");
  assertEquals(store.record?.targets.deploy.status, "failed");
  assertEquals(store.record?.targets.deploy.error, "bad password [redacted]");
});

Deno.test("RunStateWriter survives a store error without throwing", async () => {
  const store = new MemStore();
  const warnings: string[] = [];
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
    (m) => warnings.push(m),
  );
  store.failNextPut = true;
  await writer.markRunFinished(true); // best-effort: must not throw
  assertEquals(warnings.some((w) => w.includes("failed to persist")), true);
});

Deno.test("RunStateWriter re-reads and retries on a conflict", async () => {
  const store = new MemStore();
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
  );
  store.forceConflicts = 1; // first write conflicts, then the retry succeeds
  await writer.markRunFinished(true);
  assertEquals(store.record?.status, "succeeded");
});

Deno.test("RunStateWriter warns and gives up after repeated conflicts", async () => {
  const store = new MemStore();
  const warnings: string[] = [];
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
    (m) => warnings.push(m),
  );
  store.forceConflicts = 99; // exceeds the retry budget
  await writer.markRunFinished(true);
  assertEquals(warnings.some((w) => w.includes("gave up")), true);
});

Deno.test("inMemoryStateHandle stores within the run but persists nothing", async () => {
  const handle = inMemoryStateHandle();
  assertEquals(handle.get(), {});
  await handle.set({ a: 1 });
  await handle.set({ b: "x" });
  assertEquals(handle.get(), { a: 1, b: "x" });
});

// ---------------------------------------------------------------- host

Deno.test("defaultStateHost performs real filesystem effects", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const host = defaultStateHost;
    assertEquals(await host.readText(`${dir}/none`), null); // missing → null
    await host.mkdirp(`${dir}/sub`);
    await host.writeText(`${dir}/sub/a.txt`, "hi"); // creates parent
    assertEquals(await host.readText(`${dir}/sub/a.txt`), "hi");
    assertEquals(await host.createExclusive(`${dir}/lock`), true);
    assertEquals(await host.createExclusive(`${dir}/lock`), false); // exists
    await host.remove(`${dir}/lock`);
    await host.remove(`${dir}/lock`); // missing → no throw
    await host.rename(`${dir}/sub/a.txt`, `${dir}/sub/b.txt`);
    assertEquals(await host.readText(`${dir}/sub/b.txt`), "hi");
    assertEquals((await host.listDir(`${dir}/sub`)).includes("b.txt"), true);
    assertEquals(await host.listDir(`${dir}/missing`), []); // absent → []
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FileSystemStateStore errors when a lock is permanently held", async () => {
  const host = new FakeStateHost();
  host.locks.add("/runs/run-1.json.lock"); // never released
  const store = new FileSystemStateStore("/runs", host);
  await assertRejects(
    () => store.putRun(sampleRecord(), null),
    Error,
    "could not acquire",
  );
});

// ---------------------------------------------------------------- duration

Deno.test("parseDuration parses units and passes numbers through", () => {
  assertEquals(parseDuration("500ms"), 500);
  assertEquals(parseDuration("90s"), 90_000);
  assertEquals(parseDuration("30m"), 1_800_000);
  assertEquals(parseDuration("4h"), 14_400_000);
  assertEquals(parseDuration("1.5h"), 5_400_000);
  assertEquals(parseDuration("1d"), 86_400_000);
  assertEquals(parseDuration(1234), 1234);
});

Deno.test("parseDuration rejects nonsense", () => {
  assertThrows(() => parseDuration("soon"), Error, "invalid duration");
  assertThrows(() => parseDuration("10x"), Error, "invalid duration");
  assertThrows(() => parseDuration(-5), Error, "non-negative");
});

// ---------------------------------------------------------------- lock types

Deno.test("LockSettings collects key, ttl, and onConflict fluently", () => {
  const render = (h: { actor: string }) => `held by ${h.actor}`;
  const composed = new LockSettings().lockKey("deploy", "x").withTtl("4h")
    .onConflict(render);
  assertEquals(composed.key_, "deploy-x");
  assertEquals(composed.ttl_, "4h");
  assertEquals(composed.onConflict_, render);
  // .key() sets a literal key.
  assertEquals(new LockSettings().key("raw").key_, "raw");
});

Deno.test("lockKey sanitises and joins parts", () => {
  assertEquals(lockKey("deploy", "expense-service"), "deploy-expense-service");
  assertEquals(lockKey("deploy", "a/b:c"), "deploy-a_b_c");
  assertEquals(lockKey("", "x"), "x"); // empty parts dropped
});

Deno.test("LockConflictError carries the holder and guidance", () => {
  const holder = { actor: "bob", runId: "r7", since: "t" };
  const err = new LockConflictError(holder, "held by bob");
  assertEquals(err.message, "held by bob");
  assertEquals(err.holder.actor, "bob");
  assertEquals(err.name, "LockConflictError");
});

Deno.test("parseLockHolder validates untrusted holders", () => {
  const holder = { actor: "a", runId: "r", since: "t", runUrl: "https://x" };
  assertEquals(parseLockHolder(holder), holder);
  assertEquals(parseLockHolder({ actor: "a", runId: "r", since: "t" }), {
    actor: "a",
    runId: "r",
    since: "t",
  });
  assertThrows(() => parseLockHolder(5), Error, "not an object");
  assertThrows(() => parseLockHolder({ actor: "a" }), Error, "runId");
  assertThrows(
    () => parseLockHolder({ actor: "a", runId: "r", since: "t", runUrl: 5 }),
    Error,
    "runUrl",
  );
});

Deno.test("parseLockRecord round-trips and rejects malformed", () => {
  const record = {
    holder: { actor: "a", runId: "r", since: "t" },
    token: "tok",
    expiresAt: 123,
  };
  assertEquals(parseLockRecord(stringifyLockRecord(record)), record);
  assertThrows(() => parseLockRecord("nope"), Error, "not valid JSON");
  assertThrows(() => parseLockRecord("[]"), Error, "not an object");
  assertThrows(
    () => parseLockRecord(JSON.stringify({ ...record, expiresAt: "soon" })),
    Error,
    "expiresAt",
  );
});

// ---------------------------------------------------------------- fs locks

Deno.test("FileSystemStateStore locks: acquire, conflict, renew, release", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/s", host);
  const holderA = { actor: "a", runId: "r1", since: "t1" };
  const holderB = { actor: "b", runId: "r2", since: "t2" };

  const first = await store.acquireLock("deploy", holderA, 60_000);
  if (!first.ok) throw new Error("expected first acquire to win");

  // A second acquire while live loses, and learns the holder.
  const second = await store.acquireLock("deploy", holderB, 60_000);
  assertEquals(second.ok, false);
  assertEquals(second.ok === false && second.holder.runId, "r1");

  // Renew with the right token succeeds; a wrong token does not.
  assertEquals(await store.renewLock("deploy", first.token, 60_000), true);
  assertEquals(await store.renewLock("deploy", "wrong", 60_000), false);

  // Release frees it; a fresh acquire then wins.
  await store.releaseLock("deploy", first.token);
  const third = await store.acquireLock("deploy", holderB, 60_000);
  assertEquals(third.ok, true);
});

Deno.test("FileSystemStateStore locks: an expired lock is taken over (fake clock)", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/s", host);
  const won = await store.acquireLock("k", {
    actor: "a",
    runId: "r1",
    since: "t",
  }, 1000);
  if (!won.ok) throw new Error("expected acquire to win");

  // Still live: a second acquirer loses.
  const blocked = await store.acquireLock("k", {
    actor: "b",
    runId: "r2",
    since: "t",
  }, 1000);
  assertEquals(blocked.ok, false);

  // Advance past the TTL (simulating the holder being kill -9'd): take over.
  host.time += 2000;
  const took = await store.acquireLock("k", {
    actor: "b",
    runId: "r2",
    since: "t",
  }, 1000);
  assertEquals(took.ok, true);
  // The stale holder's renew now fails — it lost the lock.
  assertEquals(await store.renewLock("k", won.token, 1000), false);
});

Deno.test("FileSystemStateStore locks: concurrent acquire — exactly one wins", async () => {
  const host = new FakeStateHost();
  const store = new FileSystemStateStore("/s", host);
  const results = await Promise.all([
    store.acquireLock("k", { actor: "a", runId: "r1", since: "t" }, 60_000),
    store.acquireLock("k", { actor: "b", runId: "r2", since: "t" }, 60_000),
  ]);
  assertEquals(results.filter((r) => r.ok).length, 1);
  assertEquals(results.filter((r) => !r.ok).length, 1);
});

Deno.test("FileSystemStateStore locks: release/renew with no lock is safe", async () => {
  const store = new FileSystemStateStore("/s", new FakeStateHost());
  await store.releaseLock("absent", "tok"); // no throw
  assertEquals(await store.renewLock("absent", "tok", 1000), false);
});

// ---------------------------------------------------------------- http locks

Deno.test("HttpStateStore locks: acquire 201/409, renew, release", async () => {
  const holder = { actor: "a", runId: "r1", since: "t" };
  const store = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch((url, init) => {
      const method = init?.method;
      if (url.endsWith("/locks/held") && method === "POST") {
        return new Response(JSON.stringify(holder), { status: 409 });
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ token: "tok-9" }), {
          status: 201,
        });
      }
      if (method === "PUT") return new Response(null, { status: 200 });
      if (method === "DELETE") return new Response(null, { status: 200 });
      return new Response(null, { status: 500 });
    }),
  });
  const ok = await store.acquireLock("free", holder, 1000);
  assertEquals(ok, { ok: true, token: "tok-9" });
  const conflict = await store.acquireLock("held", holder, 1000);
  assertEquals(conflict.ok === false && conflict.holder.runId, "r1");
  assertEquals(await store.renewLock("free", "tok-9", 1000), true);
  await store.releaseLock("free", "tok-9"); // no throw
});

Deno.test("HttpStateStore locks: renew 409/404 → lost; errors throw", async () => {
  const lost = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => new Response(null, { status: 409 })),
  });
  assertEquals(await lost.renewLock("k", "t", 1000), false);

  const missing = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => new Response(null, { status: 404 })),
  });
  assertEquals(await missing.renewLock("k", "t", 1000), false);
  await missing.releaseLock("k", "t"); // 404 on release is not an error

  const boom = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(
    () => boom.acquireLock("k", { actor: "a", runId: "r", since: "t" }, 1000),
    HttpError,
  );
  await assertRejects(() => boom.renewLock("k", "t", 1000), HttpError);
  await assertRejects(() => boom.releaseLock("k", "t"), HttpError);
});

Deno.test("HttpStateStore locks: a 201 without a token is an error", async () => {
  const store = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => new Response("{}", { status: 201 })),
  });
  await assertRejects(
    () => store.acquireLock("k", { actor: "a", runId: "r", since: "t" }, 1000),
    Error,
    "did not return a token",
  );
});
