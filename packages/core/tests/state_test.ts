// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
  toJsonValue,
  toSummary,
} from "../src/state/types.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { HttpStateStore } from "../src/state/http_store.ts";
import { envStateStore, resolveStateStore } from "../src/state/resolve.ts";
import { HttpError } from "../src/http.ts";
import {
  buildRunRecord,
  ciRunUrl,
  recordStatusOf,
  resolveActor,
} from "../src/state/record.ts";
import { inMemoryStateHandle, RunStateWriter } from "../src/state/writer.ts";
import { acquireCancelLock } from "../src/state/cancel_lock.ts";
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
import { withTemp } from "./_temp.ts";
import { FakeStateHost } from "./_fakes.ts";
import { MemStateStore } from "./_fakes.ts";
import { runRecord } from "./_fakes.ts";
import { withTempStore } from "./_store.ts";

/** A minimal, valid run record for tests: parameterised and never degraded. */
function sampleRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return runRecord({
    params: { env: "sit" },
    ...overrides,
    degraded: overrides.degraded ?? false,
  });
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
      JSON.stringify({ ...sampleRecord(), degraded: "yes" }),
      '"degraded" is not a boolean',
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

Deno.test("parseRunRecord defaults a missing degraded flag to false", () => {
  // A record written before the flag existed carries no dropped write we can
  // know about, so it reads back as trustworthy rather than failing to parse.
  const { degraded: _degraded, ...older } = sampleRecord();
  assertEquals(parseRunRecord(JSON.stringify(older)).degraded, false);
  assertEquals(
    parseRunRecord(stringifyRunRecord(sampleRecord({ degraded: true })))
      .degraded,
    true,
  );
});

// A minimal WaitContext for the built-in triggers, which ignore it.
const WAIT_CTX = { state: inMemoryStateHandle(), runId: "r", target: "t" };

Deno.test("externalSignal is satisfied only when the named signal is present", async () => {
  const trigger = externalSignal("approved");
  assertEquals(trigger.descriptor, "signal:approved");
  assertEquals(await trigger.isSatisfied(new Map(), WAIT_CTX), false);
  assertEquals(
    await trigger.isSatisfied(
      new Map([["approved", { data: {}, receivedAt: "t" }]]),
      WAIT_CTX,
    ),
    true,
  );
});

Deno.test("resumeWhen evaluates the predicate and carries a poll interval", async () => {
  assertEquals(
    await resumeWhen(() => true).isSatisfied(new Map(), WAIT_CTX),
    true,
  );
  assertEquals(
    await resumeWhen(() => false).isSatisfied(new Map(), WAIT_CTX),
    false,
  );
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
  // limit returns the newest N.
  assertEquals((await store.listRuns({ limit: 2 })).map((s) => s.id), [
    "r3",
    "r2",
  ]);
  assertEquals((await store.listRuns({ limit: 0 })).length, 0);
});

Deno.test("FileSystemStateStore deleteRun removes a run; a missing run is a no-op", async () => {
  const store = new FileSystemStateStore("/runs", new FakeStateHost());
  await store.putRun(sampleRecord({ id: "r1" }), null);
  assertEquals((await store.getRun("r1")) !== null, true);
  await store.deleteRun("r1");
  assertEquals(await store.getRun("r1"), null);
  await store.deleteRun("r1"); // idempotent — no throw
  await store.deleteRun("never-existed");
});

Deno.test("FileSystemStateStore deleteRun rejects an unsafe run id", async () => {
  const store = new FileSystemStateStore("/runs", new FakeStateHost());
  await assertRejects(
    () => store.deleteRun("../escape"),
    Error,
    "unsafe run id",
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
  await withTempStore(async (store) => {
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
  });
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
      assertEquals(init?.headers, {
        Authorization: "Bearer t",
        "x-zuke-state-protocol": "1",
      });
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
    limit: 5,
  });
  assertEquals(list.length, 1);
  assertStringIncludes(lastUrl, "status=running");
  assertStringIncludes(lastUrl, "target=deploy");
  assertStringIncludes(lastUrl, "limit=5");

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

  // A 200 with a non-JSON body (e.g. a proxy HTML page) is a friendly error,
  // not a raw SyntaxError.
  const notJson = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() =>
      new Response("<html>Bad Gateway</html>", { status: 200 })
    ),
  });
  await assertRejects(
    () => notJson.listRuns({}),
    Error,
    "did not return valid JSON",
  );

  const boom = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 503 })),
  });
  await assertRejects(() => boom.listRuns({}), HttpError);
});

Deno.test("HttpStateStore.deleteRun sends DELETE; 404 is not an error, others throw", async () => {
  let method = "";
  let path = "";
  const ok = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch((url, init) => {
      method = init?.method ?? "GET";
      path = url;
      return new Response(null, { status: 204 });
    }),
  });
  await ok.deleteRun("run-1");
  assertEquals(method, "DELETE");
  assertStringIncludes(path, "/runs/run-1");

  const gone = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 404 })),
  });
  await gone.deleteRun("missing"); // 404 → no throw

  const boom = new HttpStateStore({
    url: "https://s.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => boom.deleteRun("run-1"), HttpError);
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

Deno.test("RunStateWriter records transitions and redacted state", async () => {
  const store = new MemStateStore();
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
  const store = new MemStateStore();
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

Deno.test("RunStateWriter redacts a secret in a wait trigger descriptor", async () => {
  const store = new MemStateStore();
  const redactor = new Redactor();
  redactor.add("swordfish"); // a secret routed into a signal name
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    redactor,
  );
  await writer.markTargetWaiting("deploy", {
    trigger: "signal:swordfish",
    onTimeout: "fail",
  });
  // The descriptor is masked in the persisted record (so @zuke/otel, the fs
  // store on disk, and `zuke runs show` all see the redacted form).
  assertEquals(
    store.record?.targets.deploy.waitingFor?.trigger,
    "signal:[redacted]",
  );
});

Deno.test("RunStateWriter survives a store error without throwing", async () => {
  const store = new MemStateStore();
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

Deno.test("a permanently lost write flags the record degraded for the next write to carry", async () => {
  const store = new MemStateStore();
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
  );
  assertEquals(store.record?.degraded, false);
  // Exhausting the retry budget is the one genuinely lossy path: the final
  // attempt's mutation is applied to a base that is then replaced by the
  // freshly-read record, so nothing carries the settlement forward.
  store.forceConflicts = 99;
  await writer.markTargetSettled("deploy", "passed");
  store.forceConflicts = 0;
  assertEquals(store.record?.degraded, false); // the failing write can't record it
  assertEquals(store.record?.targets.deploy.status, "pending"); // settlement lost
  await writer.markRunFinished(true);
  assertEquals(store.record?.degraded, true); // the next write that lands does
});

Deno.test("the degraded flag survives a conflict re-read", async () => {
  const store = new MemStateStore();
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
  );
  store.forceConflicts = 99;
  await writer.markTargetRunning("deploy"); // lost for good
  // The next write conflicts and re-reads a stored record that predates the
  // loss — adopting it must not silently drop the flag.
  store.forceConflicts = 1;
  await writer.markRunFinished(true);
  assertEquals(store.record?.degraded, true);
});

Deno.test("a store error does not flag the record degraded — the mutation is retained", async () => {
  const store = new MemStateStore();
  const warnings: string[] = [];
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
    (m) => warnings.push(m),
  );
  store.failNextPut = true;
  await writer.markTargetSettled("deploy", "passed"); // dropped, but still in memory
  assertEquals(warnings.some((w) => w.includes("failed to persist")), true);
  assertEquals(writer.snapshot().degraded, false);
  // The next write that lands re-persists the settlement, so nothing was lost
  // and a later resume has nothing to distrust.
  await writer.markRunFinished(true);
  assertEquals(store.record?.targets.deploy.status, "succeeded");
  assertEquals(store.record?.degraded, false);
});

Deno.test("a conflicting re-apply onto a cancelling record loses the write", async () => {
  const store = new MemStateStore();
  const warnings: string[] = [];
  let aborted = false;
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
    (m) => warnings.push(m),
    () => {
      aborted = true;
    },
  );
  if (store.record === null) throw new Error("expected the opened record");
  // Another process moved the run to `cancelling`, and re-applying onto its
  // record conflicts too. The canceller finalises the run from here, so this
  // settlement never lands anywhere — and a compensation walk that cannot see it
  // is exactly what the degraded flag has to warn a later reader about.
  store.record.status = "cancelling";
  store.forceConflicts = 2;
  await writer.markTargetSettled("deploy", "passed");
  // "settled elsewhere" rather than "cancelled": the same window is now reached
  // by a sweep failing an abandoned run as well as by an operator cancelling.
  assertEquals(warnings.some((w) => w.includes("settled elsewhere")), true);
  assertEquals(writer.snapshot().degraded, true);
  assertEquals(aborted, true);
});

Deno.test("RunStateWriter re-reads and retries on a conflict", async () => {
  const store = new MemStateStore();
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
  const store = new MemStateStore();
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
  assertEquals(writer.snapshot().degraded, true); // the update was lost
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
  await withTemp(async (dir) => {
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
  });
});

Deno.test("FileSystemStateStore errors when a lock is permanently held", async () => {
  const host = new FakeStateHost();
  const marker = "/runs/run-1.json.lock";
  host.locks.add(marker);
  host.files.set(marker, String(host.time)); // a live holder, never released
  const store = new FileSystemStateStore("/runs", host);
  await assertRejects(
    () => store.putRun(sampleRecord(), null),
    Error,
    "could not acquire",
  );
  assertEquals(host.locks.has(marker), true); // never stolen from a live holder
});

Deno.test("FileSystemStateStore takes over a mutex marker left past its TTL", async () => {
  // A holder killed mid-write leaves its marker behind. Once the marker is older
  // than the mutex TTL, the next writer reclaims it instead of wedging forever.
  const host = new FakeStateHost();
  const marker = "/runs/run-1.json.lock";
  host.locks.add(marker);
  host.files.set(marker, String(host.time)); // stamped when it was acquired
  host.time += 60_000; // …and never released

  const store = new FileSystemStateStore("/runs", host);
  const result = await store.putRun(sampleRecord(), null);
  assertEquals(result.ok, true);
  assertEquals(host.locks.has(marker), false); // released again after the write
  assertEquals(host.files.get("/runs/run-1.json") === undefined, false);
});

Deno.test("FileSystemStateStore releases a mutex marker it could not stamp", async () => {
  // The stamp write lives inside the marker's `try`, so a filesystem that
  // rejects it (a full disk, a scanner holding the freshly created file) still
  // releases the marker. Leaving an unstamped one behind would wedge the next
  // writer instead.
  const marker = "/runs/run-1.json.lock";
  class FlakyStampHost extends FakeStateHost {
    failStamp = true;
    override writeText(path: string, content: string): Promise<void> {
      if (path === marker && this.failStamp) {
        this.failStamp = false;
        return Promise.reject(new Error("ENOSPC: no space left on device"));
      }
      return super.writeText(path, content);
    }
  }
  const host = new FlakyStampHost();
  const store = new FileSystemStateStore("/runs", host);
  await assertRejects(
    () => store.putRun(sampleRecord(), null),
    Error,
    "ENOSPC",
  );
  assertEquals(host.locks.has(marker), false); // released, not left behind
  // …so the next write takes the mutex straight away rather than wedging.
  assertEquals((await store.putRun(sampleRecord(), null)).ok, true);
});

Deno.test("FileSystemStateStore never steals an unstamped mutex marker", async () => {
  // An unstamped marker carries no age — and reads exactly like a live holder in
  // the instant between creating its marker and stamping it, two syscalls a
  // waiter cannot time. Reclaiming one would put two writers inside the mutex at
  // once and let both win the same compare-and-swap, so it is left alone: the
  // write wedges and the error names the file to delete. Both shapes a real
  // filesystem can show: an empty file, and a read that comes back as nothing.
  for (const content of ["", undefined]) {
    const host = new FakeStateHost();
    const marker = "/runs/run-1.json.lock";
    host.locks.add(marker);
    if (content !== undefined) host.files.set(marker, content);
    const store = new FileSystemStateStore("/runs", host);
    await assertRejects(
      () => store.putRun(sampleRecord(), null),
      Error,
      "could not acquire the mutex",
    );
    assertEquals(host.locks.has(marker), true); // left for its holder
  }
});

Deno.test("two writers never both reclaim the same stale mutex marker", async () => {
  // Reclaiming with a bare `remove` is not a compare-and-swap: two writers that
  // read the same stale stamp would both delete a marker — the second deleting
  // the one the first had just taken — and both would run inside the mutex. The
  // trace of every hold and release of the marker must stay strictly alternating.
  const marker = "/runs/run-1.json.lock";
  const trace: string[] = [];
  class TracingHost extends FakeStateHost {
    override async createExclusive(path: string): Promise<boolean> {
      const created = await super.createExclusive(path);
      if (created && path === marker) trace.push("hold");
      return created;
    }
    override async remove(path: string): Promise<void> {
      const held = this.locks.has(path);
      await super.remove(path);
      if (held && path === marker) trace.push("free");
    }
  }
  const host = new TracingHost();
  host.locks.add(marker);
  host.files.set(marker, String(host.time - 60_000)); // abandoned 60s ago

  const store = new FileSystemStateStore("/runs", host);
  const results = await Promise.all([
    store.putRun(sampleRecord(), null),
    store.putRun(sampleRecord({ status: "succeeded" }), null),
  ]);
  assertEquals(trace, ["hold", "free", "hold", "free"]);
  // One writer publishes; the other sees the version has moved on.
  assertEquals(results.filter((r) => r.ok).length, 1);
  assertEquals(host.locks.has(marker), false);
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

Deno.test("RunStateWriter drops a write when the run vanishes after a conflict", async () => {
  const store = new MemStateStore();
  const warnings: string[] = [];
  const writer = await RunStateWriter.open(
    store,
    sampleRecord(),
    () => "t",
    new Redactor(),
    (m) => warnings.push(m),
  );
  // Simulate the run being deleted/pruned between the conflicting put and the
  // re-read: the next put conflicts, and getRun then returns null. The mutator
  // must NOT be re-applied to the already-mutated in-memory copy (which, pre-fix,
  // re-ran it and a version-null create resurrected the run) (F12).
  store.forceConflicts = 1;
  store.record = null;
  await writer.markRunFinished(true);
  assertEquals(warnings.some((w) => w.includes("vanished")), true);
  assertEquals(store.record, null); // vanished run is not resurrected
  // Not degraded: the mutation is still applied to the in-memory record, so any
  // later write that lands re-persists it. Nothing was permanently lost.
  assertEquals(writer.snapshot().degraded, false);
});

Deno.test("acquireCancelLock renews on a heartbeat and blocks a second holder", async () => {
  await withTemp(async (dir) => {
    // A store that counts the heartbeat's renewals but still renews for real.
    class CountingStore extends FileSystemStateStore {
      renewCalls = 0;
      override renewLock(
        key: string,
        token: string,
        ttlMs: number,
      ): Promise<boolean> {
        this.renewCalls++;
        return super.renewLock(key, token, ttlMs);
      }
    }
    const store = new CountingStore(`${dir}/runs`, defaultStateHost);
    const now = () => new Date().toISOString();
    // A short TTL → a 1s renewal heartbeat that fires within the test.
    const lock = await acquireCancelLock(store, "run-1", "a", now, 2000);
    if (lock === null) throw new Error("expected to acquire the cancel lock");
    // A second holder is blocked while the lock is held.
    assertEquals(await acquireCancelLock(store, "run-1", "b", now, 2000), null);
    // Outlive the 1s renewal interval so the heartbeat fires at least once.
    await new Promise((r) => setTimeout(r, 1200));
    assertEquals(store.renewCalls >= 1, true);
    await lock.release();
    // After release, a fresh holder can take it.
    const next = await acquireCancelLock(store, "run-1", "c", now, 2000);
    assertEquals(next !== null, true);
    await next?.release();
  });
});

Deno.test("a run's origin round-trips, and its absence stays an absence", () => {
  const withOrigin = sampleRecord({ buildId: "acme/api" });
  assertEquals(parseRunRecord(stringifyRunRecord(withOrigin)), withOrigin);

  // An older record has no `buildId` key at all, and must parse back without
  // one: an origin invented on read would be an origin that matches nothing,
  // and every recovery path would refuse the run.
  const older = sampleRecord();
  assertEquals("buildId" in older, false);
  const parsed = parseRunRecord(stringifyRunRecord(older));
  assertEquals("buildId" in parsed, false);
  assertEquals(parsed.buildId, undefined);
});

Deno.test("deleting a run leaves its lock records alone", async () => {
  await withTempStore(async (store) => {
    const runId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await store.putRun(
      buildRunRecord({
        runId,
        build: "B",
        rootTarget: "work",
        order: [],
        params: [],
        actor: "tester",
        now: new Date().toISOString(),
      }),
      null,
    );
    // A lease that has lapsed but was never taken over — the state a run that is
    // merely slow leaves behind, since the heartbeat cannot fire while its body
    // blocks the event loop.
    const key = `zuke-run-${runId}`;
    const held = await store.acquireLock(
      key,
      { actor: "tester", runId, since: new Date().toISOString() },
      1,
    );
    assertEquals(held.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await store.deleteRun(runId);
    assertEquals(await store.getRun(runId), null);

    // The record survives, and the holder can still renew: expiry is not
    // abandonment here — a lapsed claim stays the holder's until somebody
    // acquires it. Deleting it would make the next renewal report the lease
    // lost, stopping a run that is only slow, which is the one thing the lease
    // exists to avoid.
    assertEquals(
      await store.renewLock(key, held.ok ? held.token : "", 60_000),
      true,
    );
  });
});

// ------------------------------------------------- types: malformed branches

Deno.test("parseRunRecord rejects malformed optional and nested fields", () => {
  const cases: Array<[string, string]> = [
    // An optional string field present with the wrong type.
    [
      JSON.stringify({ ...sampleRecord(), buildId: 5 }),
      'field "buildId" is not a string',
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: { a: { status: "pending", meta: {}, effects: "x" } },
      }),
      "effects is not an object",
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: { a: { status: "pending", meta: {}, effects: { e: 5 } } },
      }),
      "effect state is not an object",
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: {
          a: {
            status: "pending",
            meta: {},
            effects: { e: { status: "weird", intentAt: "t", attempts: 1 } },
          },
        },
      }),
      'unknown effect status "weird"',
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: {
          a: {
            status: "pending",
            meta: {},
            effects: { e: { status: "pending", intentAt: "t", attempts: 0 } },
          },
        },
      }),
      "effect attempts is not a positive integer",
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        targets: { a: { status: "waiting", meta: {}, waitingFor: "x" } },
      }),
      "waitingFor is not an object",
    ],
    [
      JSON.stringify({ ...sampleRecord(), events: "x" }),
      '"events" is not an array',
    ],
    [
      JSON.stringify({ ...sampleRecord(), events: [5] }),
      "run event is not an object",
    ],
    [
      JSON.stringify({
        ...sampleRecord(),
        events: [{ at: "t", tool: "x", actor: "a", outcome: "weird" }],
      }),
      'unknown run event outcome "weird"',
    ],
    [
      JSON.stringify({ ...sampleRecord(), signals: { s: 5 } }),
      "signal record is not an object",
    ],
    [
      JSON.stringify({ ...sampleRecord(), intendedTerminal: "weird" }),
      'unknown intended terminal status "weird"',
    ],
  ];
  for (const [text, needle] of cases) {
    assertThrows(() => parseRunRecord(text), Error, needle);
  }
});

Deno.test("parseRunRecord defaults an absent target meta and signal data", () => {
  const parsed = parseRunRecord(JSON.stringify({
    ...sampleRecord(),
    // A target state written without a `meta` key still parses (empty meta),
    // and a signal without `data` reads back as a null payload.
    targets: { a: { status: "pending" } },
    signals: { approved: { receivedAt: "2026-07-17T10:00:00.000Z" } },
  }));
  assertEquals(parsed.targets.a, { status: "pending", meta: {} });
  assertEquals(parsed.signals.approved, {
    data: null,
    receivedAt: "2026-07-17T10:00:00.000Z",
  });
});

Deno.test("parseRunRecord round-trips effects, events, and terminal intent", () => {
  const record = sampleRecord({
    status: "cancelling",
    buildId: "org/app",
    deadlineAt: "2026-07-18T10:00:00.000Z",
    intendedTerminal: "failed",
    targets: {
      deploy: {
        status: "failed",
        meta: {},
        error: "boom",
        effects: {
          notify: {
            status: "failed",
            intentAt: "2026-07-17T10:00:01.000Z",
            settledAt: "2026-07-17T10:00:02.000Z",
            error: "smtp down",
            attempts: 2,
          },
          record: {
            status: "pending",
            intentAt: "2026-07-17T10:00:03.000Z",
            attempts: 1,
          },
        },
      },
    },
    events: [{
      at: "2026-07-17T10:00:04.000Z",
      tool: "signal_run",
      actor: "mcp:client",
      outcome: "denied",
      args: { name: "approved" },
      detail: "actor not allowed",
    }],
  });
  assertEquals(parseRunRecord(stringifyRunRecord(record)), record);
});

Deno.test("toJsonValue passes JSON through and rejects a non-JSON value", () => {
  assertEquals(toJsonValue({ a: [1, "x", true, null], b: { c: 2 } }), {
    a: [1, "x", true, null],
    b: { c: 2 },
  });
  // A value JSON cannot represent must be named, not silently dropped.
  assertThrows(
    () => toJsonValue(undefined),
    Error,
    'value of type "undefined" is not JSON',
  );
  assertThrows(
    () => toJsonValue(() => 1),
    Error,
    'value of type "function" is not JSON',
  );
});

// ------------------------------------------------- record: mapping branches

Deno.test("recordStatusOf maps a waiting target onto the record vocabulary", () => {
  assertEquals(recordStatusOf("waiting"), "waiting");
});

Deno.test("ciRunUrl derives the GitHub Actions run URL only when fully set", () => {
  const full: Record<string, string> = {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_RUN_ID: "123",
  };
  assertEquals(
    ciRunUrl((n) => full[n]),
    "https://github.com/o/r/actions/runs/123",
  );
  // Any missing piece means no URL — a partial one would link nowhere.
  for (const missing of Object.keys(full)) {
    const partial = { ...full };
    delete partial[missing];
    assertEquals(ciRunUrl((n) => partial[n]), undefined);
  }
});

Deno.test("buildRunRecord tolerates an unnamed target and stamps optional fields", () => {
  // A builder that never went through discoverTargets has no name; the record
  // still forms (empty name) instead of crashing mid-run.
  const anonymous = target().executes(() => {});
  const record = buildRunRecord({
    runId: "run-y",
    build: "B",
    buildId: "org/app",
    rootTarget: "work",
    actor: "alice",
    now: "2026-07-17T10:00:00.000Z",
    order: [anonymous],
    params: [],
    deadlineAt: "2026-07-18T10:00:00.000Z",
  });
  assertEquals(record.graph, [{ name: "", dependsOn: [] }]);
  assertEquals(record.targets, { "": { status: "pending", meta: {} } });
  assertEquals(record.buildId, "org/app");
  assertEquals(record.deadlineAt, "2026-07-18T10:00:00.000Z");
});

// ------------------------------------------------- host: real error paths

Deno.test("defaultStateHost surfaces non-NotFound filesystem errors", async () => {
  // A genuine I/O failure must propagate, never be masked as "missing".
  await withTemp(async (dir) => {
    const host = defaultStateHost;
    // Reading a directory as a file is not a miss.
    await assertRejects(() => host.readText(dir));
    // An exclusive create in a missing parent is not "already exists".
    await assertRejects(() => host.createExclusive(`${dir}/missing/x.lock`));
    // Removing a non-empty directory is a real error, not a missing file.
    await Deno.mkdir(`${dir}/full`);
    await Deno.writeTextFile(`${dir}/full/a.txt`, "x");
    await assertRejects(() => host.remove(`${dir}/full`));
    // Listing a regular file is not an absent directory.
    await assertRejects(() => host.listDir(`${dir}/full/a.txt`));
  });
});

// ------------------------------------------------- http store: bodied errors

Deno.test("HttpStateStore drains response bodies a server sends on every path", async () => {
  // Real servers attach error pages (and empty-object bodies) to statuses the
  // client discards; each path must drain them and keep its behaviour.
  const bodied = (status: number, headers?: Record<string, string>) =>
    new Response(`{"note":"body for ${status}"}`, { status, headers });

  const missing = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => bodied(404)),
  });
  assertEquals(await missing.getRun("r"), null); // bodied 404 is still a miss
  await missing.deleteRun("r"); // bodied 404 on delete is still a no-op

  const putOk = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch((_url, init) =>
      (init?.method ?? "GET") === "PUT"
        ? bodied(200, { etag: "v9" })
        : bodied(200)
    ),
  });
  assertEquals(await putOk.putRun(sampleRecord(), "v1"), {
    ok: true,
    version: "v9",
  });
  assertEquals(await putOk.renewLock("k", "t", 1000), true);
  await putOk.releaseLock("k", "t");
  await putOk.deleteRun("r");

  const stale = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => bodied(412)),
  });
  assertEquals(await stale.putRun(sampleRecord(), "old"), {
    ok: false,
    conflict: true,
  });

  const boom = new HttpStateStore({
    url: "https://s",
    fetch: fakeFetch(() => bodied(500)),
  });
  await assertRejects(() => boom.getRun("r"), HttpError);
  await assertRejects(() => boom.putRun(sampleRecord(), "v"), HttpError);
  await assertRejects(() => boom.listRuns({}), HttpError);
  await assertRejects(() => boom.deleteRun("r"), HttpError);
  await assertRejects(
    () => boom.acquireLock("k", { actor: "a", runId: "r", since: "t" }, 1000),
    HttpError,
  );
  await assertRejects(() => boom.renewLock("k", "t", 1000), HttpError);
  await assertRejects(() => boom.releaseLock("k", "t"), HttpError);
});
