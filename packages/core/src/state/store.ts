// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pluggable {@link StateStore} — persistence for {@link RunRecord}s — and
 * its injected filesystem host.
 *
 * The shape mirrors the remote-cache layer: a small interface plus an injected
 * host of filesystem effects, so the default backend stays unit-testable. Two
 * backends ship (both dependency-free): {@link "./fs_store.ts".FileSystemStateStore}
 * for a single host (fine for dev) and {@link "./http_store.ts".HttpStateStore}
 * for a hosted service (the production path — see `docs/state-api.md`).
 * Selection lives in {@link "./resolve.ts".resolveStateStore}. A later
 * milestone adds lock methods to this same interface.
 *
 * @module
 */

import type { RunQuery, RunRecord, RunSummary } from "./types.ts";
import type { HeldLockEntry, LockHolder } from "./lock.ts";
import { createNew, mkdirRecursive, readDir, remove, rename } from "../fs.ts";
import {
  isAlreadyExists,
  isNotFound,
  readTextOrNull,
  writeTextEnsuringDir,
} from "../internal.ts";

/** The result of a {@link StateStore.putRun} compare-and-swap write. */
export type PutResult =
  | { ok: true; version: string }
  | { ok: false; conflict: true };

/**
 * The result of {@link StateStore.acquireLock}: a `token` proving ownership, or
 * the current `holder` when the lock is already held.
 */
export type LockResult =
  | { ok: true; token: string }
  | { ok: false; holder: LockHolder };

/**
 * Pluggable persistence for run records. `version` is an opaque token (an ETag
 * or content hash) used for optimistic concurrency: a write only lands if the
 * stored version still matches the one the writer last read, so two writers
 * racing at the same version cannot both win.
 */
export interface StateStore {
  /** Fetch a run and its current version, or `null` if it does not exist. */
  getRun(id: string): Promise<{ record: RunRecord; version: string } | null>;
  /**
   * Write `record` only if the stored version equals `expectedVersion` (`null`
   * meaning "must not exist yet"). Returns the new version, or a conflict when
   * the stored version has moved on — the caller re-reads and retries.
   */
  putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult>;
  /** List runs matching `query`, newest first (by `createdAt`, then `id`). */
  listRuns(query: RunQuery): Promise<RunSummary[]>;
  /**
   * Delete a run permanently. A missing run is **not** an error (delete is
   * idempotent). Backs `zuke runs prune`; on the HTTP backend this maps to a
   * `DELETE /runs/:id` a server may leave unimplemented (retention there is the
   * server's job — see `docs/state-api.md`).
   */
  deleteRun(id: string): Promise<void>;
  /**
   * Atomically acquire the lock `key` for `holder`, expiring after `ttlMs`. An
   * expired lock is taken over. Returns a `token` on success, or the current
   * holder when the lock is live.
   */
  acquireLock(
    key: string,
    holder: LockHolder,
    ttlMs: number,
  ): Promise<LockResult>;
  /**
   * Extend the lock `key` held under `token` by another `ttlMs`. Returns `false`
   * if the token no longer owns it (expired and taken over), so a heartbeat can
   * detect a lost lock.
   */
  renewLock(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Release the lock `key` if still held under `token`; a no-op otherwise. */
  releaseLock(key: string, token: string): Promise<void>;
  /**
   * Every lock currently held, keyed and ordered by key — the read-only answer
   * to "who holds this, and until when?". Expired records are not held locks
   * and are left out: reporting one as held is the failure this exists to
   * prevent.
   *
   * Optional, so a store implemented outside this repository does not break by
   * not having one. A caller that needs the listing rather than an empty result
   * should go through {@link listStoreLocks}, which fails with a message naming
   * the backend instead of pretending the store holds nothing.
   */
  listLocks?(): Promise<HeldLockEntry[]>;
}

/**
 * The locks `store` holds, or a friendly failure when the backend cannot
 * enumerate them.
 *
 * An empty array reads as "nobody holds anything", which is the worst possible
 * answer to give someone looking at a wedged resource, so a store with no
 * {@link StateStore.listLocks} says so rather than answering.
 *
 * @throws {Error} If the store does not support listing.
 */
export function listStoreLocks(store: StateStore): Promise<HeldLockEntry[]> {
  if (store.listLocks === undefined) {
    throw new Error(
      "state: this backend cannot list locks. The filesystem store and an " +
        "HTTP backend implementing `GET /locks` both can — see docs/state-api.md.",
    );
  }
  return store.listLocks();
}

/**
 * Injected filesystem effects for {@link "./fs_store.ts".FileSystemStateStore},
 * so it stays unit-testable. The default implementation is
 * {@link defaultStateHost}.
 */
export interface StateHost {
  /** File contents, or `null` when the file does not exist. */
  readText(path: string): Promise<string | null>;
  /** Write a file's contents, creating parent directories as needed. */
  writeText(path: string, content: string): Promise<void>;
  /** Rename a file (used to publish a temp file atomically). */
  rename(from: string, to: string): Promise<void>;
  /**
   * Create `path` exclusively: resolve `true` if it was created, `false` if it
   * already existed. Used as an atomic lock marker.
   */
  createExclusive(path: string): Promise<boolean>;
  /** Remove a file; a missing file is not an error. */
  remove(path: string): Promise<void>;
  /** The entry names in a directory, or `[]` when the directory is absent. */
  listDir(path: string): Promise<string[]>;
  /** Create a directory and any missing parents. */
  mkdirp(path: string): Promise<void>;
  /** The current time in epoch milliseconds — the clock for lock expiry (injectable for tests). */
  now(): number;
}

/** The real {@link StateHost}, over the file system. */
export const defaultStateHost: StateHost = {
  readText: readTextOrNull,
  writeText: writeTextEnsuringDir,
  rename,
  async createExclusive(path: string): Promise<boolean> {
    try {
      await createNew(path);
      return true;
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  },
  async remove(path: string): Promise<void> {
    try {
      await remove(path, false);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  },
  async listDir(path: string): Promise<string[]> {
    try {
      return (await readDir(path)).map((entry) => entry.name);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  },
  mkdirp: mkdirRecursive,
  now(): number {
    return Date.now();
  },
};
