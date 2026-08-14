// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Test doubles for the core CLI's injectable seams. */

import type { GraphHost } from "../src/graph_view.ts";
import type { StateHost, StateStore } from "../src/state/store.ts";
import type { RunRecord } from "../src/state/types.ts";
import type { RemoteCacheStore } from "../src/remote_cache.ts";

/**
 * An in-memory {@link GraphHost} that records writes, directories, browser
 * opens, and logs. `existing` lists paths that {@link exists} reports as present
 * (e.g. a `zuke.json` so {@link cwd}'s root resolves).
 */
export class FakeGraphHost implements GraphHost {
  /** Virtual filesystem: path → contents. */
  readonly files = new Map<string, string>();
  /** Directories passed to {@link mkdir}. */
  readonly dirs: string[] = [];
  /** Paths passed to {@link open}. */
  readonly opened: string[] = [];
  /** Lines passed to {@link log}. */
  readonly logs: string[] = [];

  constructor(
    private readonly cwdPath = "/repo",
    private readonly existing: string[] = [],
  ) {}

  cwd(): string {
    return this.cwdPath;
  }

  exists(path: string): boolean {
    return this.existing.includes(path);
  }

  mkdir(path: string): Promise<void> {
    this.dirs.push(path);
    return Promise.resolve();
  }

  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  open(path: string): Promise<void> {
    this.opened.push(path);
    return Promise.resolve();
  }

  log(message: string): void {
    this.logs.push(message);
  }
}

/**
 * An in-memory {@link StateHost}: a flat file map plus a lock set, and a
 * controllable clock. `rename` mirrors the real filesystem closely enough for
 * the mutex paths — it rejects when the source is gone, and moves an
 * exclusively created (empty) marker just as it moves a file with content,
 * which is what reclaiming an abandoned marker relies on.
 */
export class FakeStateHost implements StateHost {
  /** Virtual filesystem: path → contents. */
  readonly files = new Map<string, string>();
  /** Paths held by {@link createExclusive}, i.e. the live lock markers. */
  readonly locks = new Set<string>();
  /** A controllable clock for the lock/mutex-TTL tests; advance it directly. */
  time = 1_000_000;

  readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content === undefined && !this.locks.has(from)) {
      return Promise.reject(new Deno.errors.NotFound(`rename ${from}`));
    }
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
    }
    if (this.locks.delete(from)) this.locks.add(to);
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
  now(): number {
    return this.time;
  }
}

/**
 * An in-memory {@link StateStore} holding a single run, versioned by a bump
 * counter, whose failure modes each test drives directly through the flags
 * below. Locks are exercised against the real backends, so the lock methods
 * throw rather than pretend.
 */
export class MemStateStore implements StateStore {
  /** The stored record, or `null` before the first put / after a delete. */
  record: RunRecord | null = null;
  /** The compare-and-swap version, bumped on every accepted put. */
  version = 0;
  /** Reject the next put with a store error. */
  failNextPut = false;
  /** Answer this many puts with a conflict before accepting one. */
  forceConflicts = 0;
  /** Return null from {@link getRun}, as though the run were pruned mid-write. */
  vanish = false;
  /** What a conflicting re-read reports the run's status as. */
  freshStatus?: RunRecord["status"];

  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getRun(): Promise<{ record: RunRecord; version: string } | null> {
    if (this.vanish || this.record === null) return Promise.resolve(null);
    const record = structuredClone(this.record);
    if (this.freshStatus !== undefined) record.status = this.freshStatus;
    return Promise.resolve({ record, version: String(this.version) });
  }
  putRun(
    record: RunRecord,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: true }> {
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
  deleteRun(): Promise<void> {
    this.record = null;
    return Promise.resolve();
  }
  acquireLock(): Promise<never> {
    throw new Error("MemStateStore: locks are unused here");
  }
  renewLock(): Promise<never> {
    throw new Error("MemStateStore: locks are unused here");
  }
  releaseLock(): Promise<never> {
    throw new Error("MemStateStore: locks are unused here");
  }
}

/** A recording in-memory {@link RemoteCacheStore}. */
export class MemCacheStore implements RemoteCacheStore {
  /** Stored artifacts: cache key → bytes. */
  readonly map = new Map<string, Uint8Array>();
  /** Keys passed to {@link get}, in order. */
  readonly gets: string[] = [];
  /** Keys passed to {@link put}, in order. */
  readonly puts: string[] = [];
  /** Reject every {@link get} with a network error. */
  failGet = false;
  /** Reject every {@link put} with a network error. */
  failPut = false;

  get(key: string): Promise<Uint8Array | null> {
    this.gets.push(key);
    if (this.failGet) return Promise.reject(new Error("network down"));
    return Promise.resolve(this.map.get(key) ?? null);
  }
  put(key: string, artifact: Uint8Array): Promise<void> {
    this.puts.push(key);
    if (this.failPut) return Promise.reject(new Error("network down"));
    this.map.set(key, artifact);
    return Promise.resolve();
  }
}

/**
 * A minimal, valid {@link RunRecord}, with `over` applied on top. Every test
 * layer needs "a record that parses", and each has its own idea of the build,
 * root target and actor — so a caller usually wraps this with its own domain
 * defaults rather than calling it bare.
 */
export function runRecord(over: Partial<RunRecord> = {}): RunRecord {
  const now = "2026-07-17T10:00:00.000Z";
  return {
    id: "run-1",
    build: "CI",
    rootTarget: "deploy",
    status: "running",
    actor: "alice",
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
