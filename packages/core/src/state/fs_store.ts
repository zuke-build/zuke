/**
 * {@link FileSystemStateStore} — a {@link StateStore} backed by one JSON file
 * per run under a directory (default `<repo root>/.zuke/runs`).
 *
 * It is single-host by design (fine for dev, per the requirement); production
 * uses {@link "./http_store.ts".HttpStateStore}. Compare-and-swap is enforced
 * with an `O_EXCL` lock marker plus an atomic temp-file rename: a writer takes
 * the lock, re-reads the current version, and only publishes if it still
 * matches — so two writers racing at the same version cannot both win. The
 * version is a content hash, mirroring the ETag the HTTP backend uses.
 *
 * @module
 */

import {
  defaultStateHost,
  type LockResult,
  type PutResult,
  type StateHost,
  type StateStore,
} from "./store.ts";
import {
  parseRunRecord,
  type RunQuery,
  type RunRecord,
  type RunSummary,
  stringifyRunRecord,
  toSummary,
} from "./types.ts";
import {
  type LockHolder,
  type LockRecord,
  parseLockRecord,
  stringifyLockRecord,
} from "./lock.ts";

const encoder = new TextEncoder();

/** Hex SHA-256 of a UTF-8 string — the opaque CAS version of a stored record. */
async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Reject a run id that could escape the runs directory. Ids are UUIDs in
 * normal use; this guards the case where one arrives from the CLI or a query.
 */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`state: unsafe run id "${id}"`);
  }
}

/** How long to wait for a contended lock before giving up. */
const LOCK_ATTEMPTS = 100;
const LOCK_DELAY_MS = 10;

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A {@link StateStore} that writes one `<id>.json` file per run under a
 * directory.
 *
 * **Security.** `dir` is *trusted configuration* — the location you choose to
 * store run state (from `ZUKE_STATE_DIR`, `--state`, or an explicit store), the
 * same posture as {@link "../remote_cache.ts".FileSystemCacheStore}. The only
 * untrusted value that reaches a path is the run **id**, which is validated at
 * every point a path is built, so a traversal cannot be smuggled in through an
 * id.
 */
export class FileSystemStateStore implements StateStore {
  readonly #dir: string;
  readonly #host: StateHost;
  #ensured = false;

  /**
   * Build the store over `dir` (created on first write). Filesystem access goes
   * through `host`, which defaults to {@link defaultStateHost}.
   */
  constructor(dir: string, host: StateHost = defaultStateHost) {
    this.#dir = dir.replace(/\/+$/, "");
    this.#host = host;
  }

  // Every run-id-derived path is built through these two helpers, and both
  // validate the id — so a traversal can't slip in via a caller that forgets to
  // check (defence in depth, not a reliance on the boundary).
  #file(id: string): string {
    assertSafeId(id);
    return `${this.#dir}/${id}.json`;
  }

  #lock(id: string): string {
    assertSafeId(id);
    return `${this.#dir}/${id}.json.lock`;
  }

  // Cross-run locks live in a `locks/` subdirectory: `<key>.json` is the lock
  // record, `<key>.acq` the short-lived acquire mutex. The key is validated the
  // same way a run id is, so it is safe as a filename.
  #lockFile(key: string): string {
    assertSafeId(key);
    return `${this.#dir}/locks/${key}.json`;
  }

  #lockMarker(key: string): string {
    assertSafeId(key);
    return `${this.#dir}/locks/${key}.acq`;
  }

  async #ensureDir(): Promise<void> {
    if (this.#ensured) return;
    await this.#host.mkdirp(this.#dir);
    await this.#host.mkdirp(`${this.#dir}/locks`);
    this.#ensured = true;
  }

  /** Fetch a run and the content-hash version of its stored file. */
  async getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    const text = await this.#host.readText(this.#file(id));
    if (text === null) return null;
    return { record: parseRunRecord(text), version: await hashText(text) };
  }

  /** Publish `record` under an exclusive lock, guarding the expected version. */
  async putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    // #lock/#file validate record.id before any path is used below.
    await this.#ensureDir();
    return await this.#withLock(record.id, async () => {
      const current = await this.#host.readText(this.#file(record.id));
      const currentVersion = current === null ? null : await hashText(current);
      if (currentVersion !== expectedVersion) {
        return { ok: false, conflict: true };
      }
      const content = stringifyRunRecord(record);
      const tmp = `${this.#file(record.id)}.tmp-${crypto.randomUUID()}`;
      await this.#host.writeText(tmp, content);
      await this.#host.rename(tmp, this.#file(record.id));
      return { ok: true, version: await hashText(content) };
    });
  }

  /** List runs matching `query`, newest first. Unreadable files are skipped. */
  async listRuns(query: RunQuery): Promise<RunSummary[]> {
    const names = await this.#host.listDir(this.#dir);
    const summaries: RunSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // skip .lock / .tmp-* markers
      const text = await this.#host.readText(`${this.#dir}/${name}`);
      if (text === null) continue;
      let record: RunRecord;
      try {
        record = parseRunRecord(text);
      } catch {
        continue; // a corrupt/partial file must not break listing the rest
      }
      if (matches(record, query)) summaries.push(toSummary(record));
    }
    return sortNewestFirst(summaries);
  }

  /** Atomically acquire the lock `key` for `holder`, taking over if expired. */
  async acquireLock(
    key: string,
    holder: LockHolder,
    ttlMs: number,
  ): Promise<LockResult> {
    await this.#ensureDir();
    return await this.#withMutex(
      this.#lockMarker(key),
      `lock "${key}"`,
      async () => {
        const current = await this.#readLock(key);
        const now = this.#host.now();
        if (current !== null && current.expiresAt > now) {
          return { ok: false, holder: current.holder };
        }
        const token = crypto.randomUUID();
        await this.#writeLock(key, { holder, token, expiresAt: now + ttlMs });
        return { ok: true, token };
      },
    );
  }

  /** Extend the lock `key` held under `token`; `false` if the token lost it. */
  async renewLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    await this.#ensureDir();
    return await this.#withMutex(
      this.#lockMarker(key),
      `lock "${key}"`,
      async () => {
        const current = await this.#readLock(key);
        if (current === null || current.token !== token) return false;
        await this.#writeLock(key, {
          ...current,
          expiresAt: this.#host.now() + ttlMs,
        });
        return true;
      },
    );
  }

  /** Release the lock `key` if still held under `token`; a no-op otherwise. */
  async releaseLock(key: string, token: string): Promise<void> {
    await this.#ensureDir();
    await this.#withMutex(this.#lockMarker(key), `lock "${key}"`, async () => {
      const current = await this.#readLock(key);
      if (current !== null && current.token === token) {
        await this.#host.remove(this.#lockFile(key));
      }
    });
  }

  /** Read a lock record, or `null` when the lock is free. */
  async #readLock(key: string): Promise<LockRecord | null> {
    const text = await this.#host.readText(this.#lockFile(key));
    return text === null ? null : parseLockRecord(text);
  }

  /** Publish a lock record via an atomic temp-file rename. */
  async #writeLock(key: string, record: LockRecord): Promise<void> {
    const file = this.#lockFile(key);
    const tmp = `${file}.tmp-${crypto.randomUUID()}`;
    await this.#host.writeText(tmp, stringifyLockRecord(record));
    await this.#host.rename(tmp, file);
  }

  /** Take the run's lock (spinning briefly on contention), run `fn`, release. */
  #withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.#withMutex(this.#lock(id), `run "${id}"`, fn);
  }

  /**
   * Hold the exclusive `marker` file (spinning briefly on contention) for the
   * duration of `fn`, then release it. `subject` names what is being guarded,
   * for the error raised if the marker cannot be taken.
   */
  async #withMutex<T>(
    marker: string,
    subject: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      if (await this.#host.createExclusive(marker)) {
        try {
          return await fn();
        } finally {
          await this.#host.remove(marker);
        }
      }
      await delay(LOCK_DELAY_MS);
    }
    throw new Error(
      `state: could not acquire the mutex for ${subject} — ` +
        `a stale ${marker} may need removing.`,
    );
  }
}

/** Whether a record passes a {@link RunQuery}. */
function matches(record: RunRecord, query: RunQuery): boolean {
  if (query.status !== undefined && record.status !== query.status) {
    return false;
  }
  if (
    query.target !== undefined &&
    !record.graph.some((node) => node.name === query.target)
  ) {
    return false;
  }
  if (query.since !== undefined && record.createdAt < query.since) return false;
  return true;
}

/** Sort by `createdAt` descending, then `id` descending, for stable output. */
function sortNewestFirst(summaries: RunSummary[]): RunSummary[] {
  return summaries.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? (a.createdAt < b.createdAt ? 1 : -1)
      : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}
