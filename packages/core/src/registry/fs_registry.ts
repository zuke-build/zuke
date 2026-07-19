/**
 * {@link FileSystemBuildRegistry} — a {@link BuildRegistry} backed by one JSON
 * file per build under a directory (default `<repo root>/.zuke/builds`).
 *
 * It is single-host by design (fine for dev, per the requirement); production
 * uses {@link "./http_registry.ts".HttpBuildRegistry}. Compare-and-swap is
 * enforced with an `O_EXCL` lock marker plus an atomic temp-file rename — the
 * same trick as {@link "../state/fs_store.ts".FileSystemStateStore} — so two
 * registrations racing at the same version cannot both win. The version is a
 * content hash, mirroring the ETag the HTTP backend uses.
 *
 * @module
 */

import { defaultStateHost, type StateHost } from "../state/store.ts";
import {
  type BuildDescriptor,
  type BuildQuery,
  type BuildSummary,
  parseBuildDescriptor,
  stringifyBuildDescriptor,
  toBuildSummary,
} from "./descriptor.ts";
import type { BuildRegistry, PutBuildResult } from "./registry.ts";

const encoder = new TextEncoder();

/** Hex SHA-256 of a UTF-8 string — the opaque CAS version of a stored descriptor. */
async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Reject a build id that could escape the builds directory. Ids are build class
 * names in normal use; this guards the case where one arrives from the CLI or a
 * query.
 */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`registry: unsafe build id "${id}"`);
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
 * A {@link BuildRegistry} that writes one `<id>.json` file per build under a
 * directory.
 *
 * **Security.** `dir` is *trusted configuration* — the location you choose to
 * store the build catalog (from `ZUKE_REGISTRY_DIR` or an explicit registry),
 * the same posture as {@link "../state/fs_store.ts".FileSystemStateStore}. The
 * only untrusted value that reaches a path is the build **id**, validated at
 * every point a path is built, so a traversal cannot be smuggled in via an id.
 */
export class FileSystemBuildRegistry implements BuildRegistry {
  readonly #dir: string;
  readonly #host: StateHost;
  #ensured = false;

  /**
   * Build the registry over `dir` (created on first write). Filesystem access
   * goes through `host`, which defaults to
   * {@link "../state/store.ts".defaultStateHost}.
   */
  constructor(dir: string, host: StateHost = defaultStateHost) {
    this.#dir = dir.replace(/\/+$/, "");
    this.#host = host;
  }

  // Both id-derived paths are built through these helpers, and both validate the
  // id — so a traversal can't slip in via a caller that forgets to check.
  #file(id: string): string {
    assertSafeId(id);
    return `${this.#dir}/${id}.json`;
  }

  #lock(id: string): string {
    assertSafeId(id);
    return `${this.#dir}/${id}.json.lock`;
  }

  async #ensureDir(): Promise<void> {
    if (this.#ensured) return;
    await this.#host.mkdirp(this.#dir);
    this.#ensured = true;
  }

  /** Fetch a build and the content-hash version of its stored file. */
  async getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null> {
    const text = await this.#host.readText(this.#file(id));
    if (text === null) return null;
    return {
      descriptor: parseBuildDescriptor(text),
      version: await hashText(text),
    };
  }

  /** Publish `descriptor` under an exclusive lock, guarding the expected version. */
  async register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult> {
    // #lock/#file validate descriptor.id before any path is used below.
    await this.#ensureDir();
    return await this.#withLock(descriptor.id, async () => {
      const current = await this.#host.readText(this.#file(descriptor.id));
      const currentVersion = current === null ? null : await hashText(current);
      if (currentVersion !== expectedVersion) {
        return { ok: false, conflict: true };
      }
      const content = stringifyBuildDescriptor(descriptor);
      const tmp = `${this.#file(descriptor.id)}.tmp-${crypto.randomUUID()}`;
      await this.#host.writeText(tmp, content);
      await this.#host.rename(tmp, this.#file(descriptor.id));
      return { ok: true, version: await hashText(content) };
    });
  }

  /** Remove a registered build under an exclusive lock; a missing file is a no-op. */
  async deregister(id: string): Promise<void> {
    await this.#ensureDir();
    await this.#withLock(id, () => this.#host.remove(this.#file(id)));
  }

  /** List builds matching `query`, newest first. Unreadable files are skipped. */
  async listBuilds(query: BuildQuery): Promise<BuildSummary[]> {
    const names = await this.#host.listDir(this.#dir);
    const summaries: BuildSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // skip .lock / .tmp-* markers
      const text = await this.#host.readText(`${this.#dir}/${name}`);
      if (text === null) continue;
      let descriptor: BuildDescriptor;
      try {
        descriptor = parseBuildDescriptor(text);
      } catch {
        continue; // a corrupt/partial file must not break listing the rest
      }
      if (matches(descriptor, query)) {
        summaries.push(toBuildSummary(descriptor));
      }
    }
    return sortNewestFirst(summaries);
  }

  /** Take the build's lock (spinning briefly on contention), run `fn`, release. */
  async #withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const marker = this.#lock(id);
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
      `registry: could not acquire the mutex for build "${id}" — ` +
        `a stale ${marker} may need removing.`,
    );
  }
}

/** Whether a descriptor passes a {@link BuildQuery}. */
function matches(descriptor: BuildDescriptor, query: BuildQuery): boolean {
  if (query.name !== undefined && descriptor.name !== query.name) return false;
  if (query.since !== undefined && descriptor.createdAt < query.since) {
    return false;
  }
  return true;
}

/** Sort by `createdAt` descending, then `id` descending, for stable output. */
function sortNewestFirst(summaries: BuildSummary[]): BuildSummary[] {
  return summaries.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? (a.createdAt < b.createdAt ? 1 : -1)
      : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}
