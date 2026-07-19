/**
 * A backend conformance kit for the state-api (`docs/state-api.md`).
 *
 * A hosted {@link "./state/store.ts".StateStore} / {@link
 * "./registry/registry.ts".BuildRegistry} backend must implement the same
 * compare-and-swap, listing, and TTL-lock semantics the filesystem backend
 * does — the exactly-once resume, lock takeover, and one-writer-wins guarantees
 * the core relies on ride on them. This module extracts those semantics into
 * store-agnostic scenarios you can point at any implementation: Zuke's own test
 * lane runs them against the filesystem store, and a backend author runs them
 * against a live service:
 *
 * ```sh
 * deno run -A jsr:@zuke/core/conformance --url http://localhost:8080 [--token …]
 * ```
 *
 * Every scenario uses freshly-generated ids, so it is safe to run against a
 * shared, persistent service; the lock-takeover scenario uses a short real TTL
 * and a brief sleep, so it takes a beat of wall-clock time. A backend that
 * passes is compatible with
 * {@link "./state/http_store.ts".HttpStateStore} /
 * {@link "./registry/http_registry.ts".HttpBuildRegistry}; one that violates
 * CAS fails loudly.
 *
 * @module
 */

import type { RunEvent, RunRecord } from "./state/types.ts";
import type { StateStore } from "./state/store.ts";
import type { LockHolder } from "./state/lock.ts";
import { HttpStateStore } from "./state/http_store.ts";
import type { BuildDescriptor } from "./registry/descriptor.ts";
import type { BuildRegistry } from "./registry/registry.ts";
import { HttpBuildRegistry } from "./registry/http_registry.ts";

/** The outcome of one conformance scenario. */
export interface ConformanceResult {
  /** The scenario's name. */
  readonly name: string;
  /** Whether the backend satisfied it. */
  readonly ok: boolean;
  /** The failure detail when `ok` is false. */
  readonly error?: string;
}

/** Tuning options for the conformance scenarios. */
export interface ConformanceOptions {
  /**
   * The lock TTL (ms) the takeover scenario acquires with; it then waits a bit
   * longer than this for the lock to expire. Raise it for a slow backend.
   * Default 200.
   */
  lockTtlMs?: number;
}

/** A `() =>` factory the kit calls once to obtain the store under test. */
export type StateStoreFactory = () => StateStore | Promise<StateStore>;

/** A `() =>` factory the kit calls once to obtain the registry under test. */
export type BuildRegistryFactory = () => BuildRegistry | Promise<BuildRegistry>;

/** The message of an unknown thrown value, without casting. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Assert `condition`, throwing `message` (a scenario failure) otherwise. */
function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** A unique id for a scenario's records, safe on a shared, persistent backend. */
function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A TTL long enough that a live-lock scenario never races the expiry (1 hour). */
const LIVE_TTL_MS = 3_600_000;

/** A minimal valid {@link RunRecord} with the given id and overrides. */
function record(id: string, over: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    id,
    build: "Conformance",
    rootTarget: "deploy",
    status: "running",
    actor: "conformance",
    createdAt: now,
    updatedAt: now,
    graph: [{ name: "deploy", dependsOn: [] }],
    params: {},
    targets: { deploy: { status: "pending", meta: {} } },
    signals: {},
    events: [],
    ...over,
  };
}

/** A minimal {@link RunEvent}. */
function event(tool: string): RunEvent {
  return {
    at: new Date().toISOString(),
    tool,
    actor: "conformance",
    outcome: "ok",
    args: {},
  };
}

/** A {@link LockHolder} for the given actor and run. */
function holder(actor: string, runId: string): LockHolder {
  return { actor, runId, since: new Date().toISOString() };
}

/** One named scenario over a store. */
interface StateScenario {
  name: string;
  run(store: StateStore, options: Required<ConformanceOptions>): Promise<void>;
}

/** The state-store semantic scenarios (store-agnostic). */
const STATE_SCENARIOS: StateScenario[] = [
  {
    name: "putRun creates a record getRun round-trips",
    async run(store) {
      const id = uniqueId("run");
      const put = await store.putRun(record(id), null);
      expect(put.ok, "create putRun should succeed");
      const loaded = await store.getRun(id);
      expect(loaded !== null, "getRun should find the created record");
      expect(loaded?.record.id === id, "getRun should return the same id");
    },
  },
  {
    name: "putRun CAS rejects a stale version",
    async run(store) {
      const id = uniqueId("run");
      const created = await store.putRun(record(id), null);
      expect(created.ok, "create should succeed");
      const first = created.ok ? created.version : "";
      // The update changes the record's content, so the version genuinely
      // advances on any versioning scheme (content hash, ETag, counter).
      const updated = await store.putRun(
        record(id, { status: "succeeded" }),
        first,
      );
      expect(updated.ok, "an in-order update should succeed");
      // Writing again at the now-stale first version must conflict, not clobber.
      const stale = await store.putRun(record(id, { status: "failed" }), first);
      expect(!stale.ok, "a write at a stale version must be a conflict");
    },
  },
  {
    name: "concurrent writers at one version: exactly one wins",
    async run(store) {
      const id = uniqueId("run");
      const created = await store.putRun(record(id), null);
      const version = created.ok ? created.version : "";
      // Distinct content per writer, so the winner's write really changes the
      // version and the loser's compare-and-swap sees the change (a
      // content-hash backend would otherwise let two identical writes both win).
      const [a, b] = await Promise.all([
        store.putRun(record(id, { status: "succeeded" }), version),
        store.putRun(record(id, { status: "failed" }), version),
      ]);
      const winners = [a, b].filter((r) => r.ok).length;
      expect(
        winners === 1,
        `exactly one concurrent writer must win, got ${winners}`,
      );
    },
  },
  {
    name: "listRuns filters by target, status, since, and limit, newest first",
    async run(store) {
      // A unique graph target isolates this run set on a shared backend.
      const target = uniqueId("t");
      const graph = [{ name: target, dependsOn: [] }];
      await store.putRun(
        record(uniqueId("run"), {
          graph,
          status: "failed",
          createdAt: "2020-01-01T00:00:00.000Z",
        }),
        null,
      );
      await store.putRun(
        record(uniqueId("run"), {
          graph,
          status: "succeeded",
          createdAt: "2020-01-03T00:00:00.000Z",
        }),
        null,
      );
      await store.putRun(
        record(uniqueId("run"), {
          graph,
          status: "failed",
          createdAt: "2020-01-02T00:00:00.000Z",
        }),
        null,
      );
      const all = await store.listRuns({ target });
      expect(
        all.length === 3,
        `listRuns should return the 3 runs, got ${all.length}`,
      );
      const order = all.map((r) => r.createdAt);
      expect(
        order[0] >= order[1] && order[1] >= order[2],
        `listRuns should sort newest first, got ${order.join(",")}`,
      );
      const failed = await store.listRuns({ target, status: "failed" });
      expect(
        failed.length === 2,
        `status filter should return 2, got ${failed.length}`,
      );
      const since = await store.listRuns({
        target,
        since: "2020-01-02T00:00:00.000Z",
      });
      expect(
        since.length === 2,
        `since filter should return the 2 at/after the cutoff, got ${since.length}`,
      );
      const limited = await store.listRuns({ target, limit: 2 });
      expect(
        limited.length === 2,
        `limit should cap the result at 2, got ${limited.length}`,
      );
      expect(
        limited.map((r) => r.createdAt).join(",") ===
          all.slice(0, 2).map((r) => r.createdAt).join(","),
        "limit should keep the newest runs, in newest-first order",
      );
    },
  },
  {
    name: "run events round-trip and preserve order",
    async run(store) {
      const id = uniqueId("run");
      const created = await store.putRun(
        record(id, { events: [event("a")] }),
        null,
      );
      const v1 = created.ok ? created.version : "";
      const appended = await store.putRun(
        record(id, { events: [event("a"), event("b")] }),
        v1,
      );
      expect(appended.ok, "appending an event should succeed");
      const loaded = await store.getRun(id);
      const tools = loaded?.record.events.map((e) => e.tool) ?? [];
      expect(
        tools.length === 2 && tools[0] === "a" && tools[1] === "b",
        `events should round-trip in order, got ${tools.join(",")}`,
      );
    },
  },
  {
    name:
      "acquireLock grants a token; a second acquire conflicts with the holder",
    async run(store) {
      const key = uniqueId("lock");
      // A long TTL so the lock is unambiguously live when the second acquire
      // runs — the conflict check must not race the expiry, even on a slow
      // remote backend (the takeover scenario is where expiry is exercised).
      const first = await store.acquireLock(
        key,
        holder("alice", "r1"),
        LIVE_TTL_MS,
      );
      expect(first.ok, "the first acquire should grant a token");
      const second = await store.acquireLock(
        key,
        holder("bob", "r2"),
        LIVE_TTL_MS,
      );
      expect(!second.ok, "a second acquire on a live lock must conflict");
      expect(
        !second.ok && second.holder.actor === "alice",
        "the conflict must name the current holder",
      );
      if (first.ok) await store.releaseLock(key, first.token);
    },
  },
  {
    name: "an expired lock is taken over; the old token loses it",
    async run(store, options) {
      const key = uniqueId("lock");
      const first = await store.acquireLock(
        key,
        holder("alice", "r1"),
        options.lockTtlMs,
      );
      expect(first.ok, "the first acquire should succeed");
      await sleep(options.lockTtlMs + 150);
      const takeover = await store.acquireLock(
        key,
        holder("bob", "r2"),
        options.lockTtlMs,
      );
      expect(takeover.ok, "an expired lock must be taken over");
      if (first.ok) {
        const renewed = await store.renewLock(
          key,
          first.token,
          options.lockTtlMs,
        );
        expect(!renewed, "the evicted token must fail to renew");
      }
      if (takeover.ok) await store.releaseLock(key, takeover.token);
    },
  },
  {
    name: "concurrent acquire: exactly one wins",
    async run(store) {
      const key = uniqueId("lock");
      const [a, b] = await Promise.all([
        store.acquireLock(key, holder("alice", "r1"), LIVE_TTL_MS),
        store.acquireLock(key, holder("bob", "r2"), LIVE_TTL_MS),
      ]);
      const winners = [a, b].filter((r) => r.ok).length;
      expect(
        winners === 1,
        `exactly one concurrent acquire must win, got ${winners}`,
      );
      if (a.ok) await store.releaseLock(key, a.token);
      if (b.ok) await store.releaseLock(key, b.token);
    },
  },
  {
    name: "renew and release of an absent lock are safe",
    async run(store) {
      const key = uniqueId("lock");
      const renewed = await store.renewLock(key, "nope", LIVE_TTL_MS);
      expect(!renewed, "renewing a lock nobody holds must return false");
      await store.releaseLock(key, "nope"); // must not throw
    },
  },
];

/** Run the state-store conformance scenarios against the store `make` builds. */
export async function checkStateStore(
  make: StateStoreFactory,
  options: ConformanceOptions = {},
): Promise<ConformanceResult[]> {
  const store = await make();
  const resolved: Required<ConformanceOptions> = {
    lockTtlMs: options.lockTtlMs ?? 200,
  };
  const results: ConformanceResult[] = [];
  for (const scenario of STATE_SCENARIOS) {
    try {
      await scenario.run(store, resolved);
      results.push({ name: scenario.name, ok: true });
    } catch (error) {
      results.push({ name: scenario.name, ok: false, error: messageOf(error) });
    }
  }
  return results;
}

/** A minimal valid {@link BuildDescriptor} with the given id. */
function descriptor(
  id: string,
  over: Partial<BuildDescriptor> = {},
): BuildDescriptor {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    location: { kind: "module", module: `file:///${id}.ts`, cwd: "/" },
    surface: { commands: [], flags: [], targets: [], parameters: [] },
    actor: "conformance",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** One named scenario over a registry. */
interface RegistryScenario {
  name: string;
  run(registry: BuildRegistry): Promise<void>;
}

/** The build-registry semantic scenarios (store-agnostic). */
const REGISTRY_SCENARIOS: RegistryScenario[] = [
  {
    name: "register creates a descriptor getBuild round-trips",
    async run(registry) {
      const id = uniqueId("build");
      const put = await registry.register(descriptor(id), null);
      expect(put.ok, "create register should succeed");
      const loaded = await registry.getBuild(id);
      expect(
        loaded?.descriptor.id === id,
        "getBuild should return the descriptor",
      );
    },
  },
  {
    name: "register CAS rejects a stale version",
    async run(registry) {
      const id = uniqueId("build");
      const created = await registry.register(descriptor(id), null);
      const first = created.ok ? created.version : "";
      // Distinct content, so the version advances on any versioning scheme.
      const updated = await registry.register(
        descriptor(id, { actor: "updated" }),
        first,
      );
      expect(updated.ok, "an in-order update should succeed");
      const stale = await registry.register(
        descriptor(id, { actor: "stale" }),
        first,
      );
      expect(!stale.ok, "a register at a stale version must be a conflict");
    },
  },
  {
    name: "deregister removes a build",
    async run(registry) {
      const id = uniqueId("build");
      await registry.register(descriptor(id), null);
      await registry.deregister(id);
      const loaded = await registry.getBuild(id);
      expect(loaded === null, "getBuild after deregister must be a miss");
    },
  },
  {
    name: "listBuilds filters by name and since, newest first",
    async run(registry) {
      // A shared name (distinct ids) isolates this set on a shared backend.
      const name = uniqueId("app");
      await registry.register(
        descriptor(uniqueId("build"), {
          name,
          createdAt: "2020-01-01T00:00:00.000Z",
        }),
        null,
      );
      await registry.register(
        descriptor(uniqueId("build"), {
          name,
          createdAt: "2020-01-03T00:00:00.000Z",
        }),
        null,
      );
      await registry.register(
        descriptor(uniqueId("build"), {
          name,
          createdAt: "2020-01-02T00:00:00.000Z",
        }),
        null,
      );
      const all = await registry.listBuilds({ name });
      expect(
        all.length === 3,
        `name filter should return 3, got ${all.length}`,
      );
      const order = all.map((b) => b.createdAt);
      expect(
        order[0] >= order[1] && order[1] >= order[2],
        `listBuilds should sort newest first, got ${order.join(",")}`,
      );
      const since = await registry.listBuilds({
        name,
        since: "2020-01-02T00:00:00.000Z",
      });
      expect(
        since.length === 2,
        `since filter should return the 2 at/after the cutoff, got ${since.length}`,
      );
    },
  },
];

/** Run the build-registry conformance scenarios against the registry `make` builds. */
export async function checkBuildRegistry(
  make: BuildRegistryFactory,
): Promise<ConformanceResult[]> {
  const registry = await make();
  const results: ConformanceResult[] = [];
  for (const scenario of REGISTRY_SCENARIOS) {
    try {
      await scenario.run(registry);
      results.push({ name: scenario.name, ok: true });
    } catch (error) {
      results.push({ name: scenario.name, ok: false, error: messageOf(error) });
    }
  }
  return results;
}

/** Injectable dependencies for {@link runConformanceCli} (tests override them). */
export interface ConformanceCliDeps {
  /** Build the {@link StateStore} for a url/token (default {@link HttpStateStore}). */
  makeStateStore?: (url: string, token?: string) => StateStore;
  /** Build the {@link BuildRegistry} for a url/token (default {@link HttpBuildRegistry}). */
  makeBuildRegistry?: (url: string, token?: string) => BuildRegistry;
  /** Emit a line of output (default `console.log`). */
  log?: (line: string) => void;
}

/**
 * Run the conformance kit as a CLI: `--url <base>` (required) and `--token
 * <bearer>` (optional) name the backend, then both suites run against it. Prints
 * a `PASS`/`FAIL` line per scenario and resolves to a process exit code — `0`
 * when every scenario passes, `1` when any fails or `--url` is missing.
 */
export async function runConformanceCli(
  args: string[],
  deps: ConformanceCliDeps = {},
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const url = flag(args, "--url");
  const token = flag(args, "--token");
  if (url === undefined) {
    log("conformance: --url <base> is required.");
    return 1;
  }
  const makeState = deps.makeStateStore ??
    ((u: string, t?: string) => new HttpStateStore({ url: u, token: t }));
  const makeRegistry = deps.makeBuildRegistry ??
    ((u: string, t?: string) => new HttpBuildRegistry({ url: u, token: t }));

  const results: ConformanceResult[] = [];
  try {
    results.push(...await checkStateStore(() => makeState(url, token)));
    results.push(...await checkBuildRegistry(() => makeRegistry(url, token)));
  } catch (error) {
    // A transport/protocol failure (e.g. a version mismatch) aborts the run.
    log(`conformance: aborted — ${messageOf(error)}`);
    return 1;
  }

  let failures = 0;
  for (const result of results) {
    if (result.ok) {
      log(`PASS  ${result.name}`);
    } else {
      failures++;
      log(`FAIL  ${result.name}\n        ${result.error ?? ""}`);
    }
  }
  log(`\n${results.length - failures}/${results.length} scenarios passed.`);
  return failures === 0 ? 0 : 1;
}

/** Read `--name value` or `--name=value` from `args`, or `undefined`. */
function flag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1];
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return undefined;
}

if (import.meta.main) {
  Deno.exit(await runConformanceCli(Deno.args));
}
