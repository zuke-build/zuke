/**
 * The state-api conformance kit, run against Zuke's own filesystem backend (it
 * must pass), a deliberately CAS-violating fake (it must fail loudly), and the
 * CLI runner — plus the wire protocol-version handshake on the HTTP client.
 */

import { assertEquals, assertRejects } from "./_assert.ts";
import {
  checkBuildRegistry,
  checkStateStore,
  type ConformanceResult,
  runConformanceCli,
} from "../src/conformance.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { FileSystemBuildRegistry } from "../src/registry/fs_registry.ts";
import { defaultStateHost } from "../src/state/store.ts";
import type { LockResult, PutResult, StateStore } from "../src/state/store.ts";
import type { RunSummary } from "../src/state/types.ts";
import { HttpStateStore } from "../src/state/http_store.ts";
import type { BuildRegistry } from "../src/registry/registry.ts";
import {
  type BuildDescriptor,
  type BuildQuery,
  toBuildSummary,
} from "../src/registry/descriptor.ts";

/** A short TTL keeps the lock-takeover scenarios fast in the test lane. */
const FAST = { lockTtlMs: 50 };

/** The names of failing scenarios in a result set. */
function failures(results: ConformanceResult[]): string[] {
  return results.filter((r) => !r.ok).map((r) => r.name);
}

Deno.test("the kit passes against the filesystem state store", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-conf-state-" });
  try {
    const results = await checkStateStore(
      () => new FileSystemStateStore(`${dir}/runs`, defaultStateHost),
      FAST,
    );
    assertEquals(failures(results), []);
    assertEquals(results.length > 0, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the kit passes against the filesystem build registry", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-conf-reg-" });
  try {
    const results = await checkBuildRegistry(
      () => new FileSystemBuildRegistry(`${dir}/builds`, defaultStateHost),
    );
    assertEquals(failures(results), []);
    assertEquals(results.length > 0, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A store that never enforces CAS: every write "succeeds", nothing persists. */
class NoCasStore implements StateStore {
  getRun(): Promise<{ record: never; version: string } | null> {
    return Promise.resolve(null);
  }
  putRun(): Promise<PutResult> {
    return Promise.resolve({ ok: true, version: "v" }); // never conflicts
  }
  listRuns(): Promise<RunSummary[]> {
    return Promise.resolve([]);
  }
  acquireLock(): Promise<LockResult> {
    return Promise.resolve({ ok: true, token: "t" }); // never contends
  }
  renewLock(): Promise<boolean> {
    return Promise.resolve(true);
  }
  releaseLock(): Promise<void> {
    return Promise.resolve();
  }
}

Deno.test("the kit fails loudly against a CAS-violating store", async () => {
  const results = await checkStateStore(() => new NoCasStore(), FAST);
  const failed = failures(results);
  // The CAS scenario in particular must be reported as a failure.
  assertEquals(
    results.find((r) => r.name.includes("CAS"))?.ok,
    false,
  );
  assertEquals(failed.length > 0, true);
});

Deno.test("runConformanceCli passes over injected FS backends, fails on violations", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-conf-cli-" });
  const lines: string[] = [];
  try {
    // Missing --url is a usage error.
    assertEquals(await runConformanceCli([], { log: (l) => lines.push(l) }), 1);

    // A good FS-backed run exits 0 and reports every scenario.
    const ok = await runConformanceCli(["--url", "unused"], {
      makeStateStore: () =>
        new FileSystemStateStore(`${dir}/a`, defaultStateHost),
      makeBuildRegistry: () =>
        new FileSystemBuildRegistry(`${dir}/b`, defaultStateHost),
      log: (l) => lines.push(l),
    });
    assertEquals(ok, 0);
    assertEquals(lines.some((l) => l.startsWith("PASS")), true);

    // A CAS-violating backend exits 1.
    const bad = await runConformanceCli(["--url=unused"], {
      makeStateStore: () => new NoCasStore(),
      makeBuildRegistry: () =>
        new FileSystemBuildRegistry(`${dir}/c`, defaultStateHost),
      log: (l) => lines.push(l),
    });
    assertEquals(bad, 1);
    assertEquals(lines.some((l) => l.startsWith("FAIL")), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the HTTP client rejects a server that declares a mismatched protocol", async () => {
  const store = new HttpStateStore({
    url: "https://s.example",
    fetch: () =>
      Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { etag: "v1", "x-zuke-state-protocol": "999" },
        }),
      ),
  });
  await assertRejects(() => store.getRun("run-1"), Error, "protocol mismatch");
});

Deno.test("the HTTP client tolerates a server that omits the protocol header", async () => {
  // A backend predating the header is assumed compatible (no version declared).
  const store = new HttpStateStore({
    url: "https://s.example",
    fetch: (_url, _init) =>
      Promise.resolve(new Response(null, { status: 404 })),
  });
  assertEquals(await store.getRun("missing"), null);
});

/** A registry correct at CAS but returning listBuilds in insertion (not newest-first) order. */
class BadOrderRegistry implements BuildRegistry {
  #map = new Map<string, { descriptor: BuildDescriptor; version: number }>();
  getBuild(id: string) {
    const held = this.#map.get(id);
    return Promise.resolve(
      held
        ? { descriptor: held.descriptor, version: String(held.version) }
        : null,
    );
  }
  register(descriptor: BuildDescriptor, expected: string | null) {
    const held = this.#map.get(descriptor.id);
    const current = held ? String(held.version) : null;
    if (current !== expected) {
      return Promise.resolve({ ok: false as const, conflict: true as const });
    }
    const version = (held?.version ?? 0) + 1;
    this.#map.set(descriptor.id, { descriptor, version });
    return Promise.resolve({ ok: true as const, version: String(version) });
  }
  deregister(id: string) {
    this.#map.delete(id);
    return Promise.resolve();
  }
  listBuilds(query: BuildQuery) {
    // Correct filtering, but WRONG order (insertion order, not newest-first).
    const rows = [...this.#map.values()]
      .map((h) => toBuildSummary(h.descriptor))
      .filter((b) => query.name === undefined || b.name === query.name)
      .filter((b) => query.since === undefined || b.createdAt >= query.since);
    return Promise.resolve(rows);
  }
}

Deno.test("the kit catches a registry that violates listBuilds ordering", async () => {
  const results = await checkBuildRegistry(() => new BadOrderRegistry());
  // CAS/round-trip/deregister pass; only the ordering+filter scenario fails.
  assertEquals(results.find((r) => r.name.includes("newest first"))?.ok, false);
  assertEquals(results.find((r) => r.name.includes("CAS"))?.ok, true);
});
