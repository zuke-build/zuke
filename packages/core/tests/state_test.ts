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
import { target } from "../src/target.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { discoverParameters, parameter } from "../src/params.ts";

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
  ];
  for (const [text, needle] of cases) {
    assertThrows(() => parseRunRecord(text), Error, needle);
  }
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
