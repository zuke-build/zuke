/**
 * Incremental-build cache: fingerprints a target's declared {@link
 * TargetBuilder.inputs} and lets the executor skip it when nothing has changed
 * since the last successful run and its {@link TargetBuilder.outputs} still
 * exist.
 *
 * The fingerprint is a SHA-256 over the contents of every input (directories
 * hashed recursively), computed with the built-in Web Crypto API — no
 * dependency. Fingerprints persist in `<repo root>/.zuke/cache.json`. All
 * filesystem effects go through an injectable {@link CacheHost} so the logic
 * stays unit-testable.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";
import { messageOf } from "./internal.ts";
import {
  archiveOutputs,
  type OutputHost,
  remoteCacheKey,
  type RemoteCacheStore,
  restoreOutputs,
} from "./remote_cache.ts";

/** The cache store file name within the `.zuke/` artifact directory. */
export const CACHE_FILE = "cache.json";

/**
 * Injected filesystem effects, so {@link openCache} is unit-testable. Extends
 * {@link OutputHost} (read/write files for remote output archiving) with the
 * cache-store read/write used by the local fingerprint store.
 */
export interface CacheHost extends OutputHost {
  /** The cache store text, or `null` if it does not exist yet. */
  readStore(path: string): Promise<string | null>;
  /** Write the cache store text, creating parent directories. */
  writeStore(path: string, content: string): Promise<void>;
}

/** The real, `Deno`-backed {@link CacheHost}. */
export const defaultCacheHost: CacheHost = {
  async readFile(path: string): Promise<Uint8Array | null> {
    try {
      return await Deno.readFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  async stat(path: string): Promise<{ isDirectory: boolean } | null> {
    try {
      const info = await Deno.stat(path);
      return { isDirectory: info.isDirectory };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  async readDir(path: string): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of Deno.readDir(path)) names.push(entry.name);
    return names;
  },
  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const slash = path.replace(/\\/g, "/").lastIndexOf("/");
    if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
    await Deno.writeFile(path, bytes);
  },
  async readStore(path: string): Promise<string | null> {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  async writeStore(path: string, content: string): Promise<void> {
    const slash = path.replace(/\\/g, "/").lastIndexOf("/");
    if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
    await Deno.writeTextFile(path, content);
  },
};

const encoder = new TextEncoder();

/** Hex SHA-256 of raw bytes. */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the digest input type is
  // unambiguous regardless of the source buffer (e.g. a SharedArrayBuffer).
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Hex SHA-256 of a UTF-8 string. */
function hashText(text: string): Promise<string> {
  return hashBytes(encoder.encode(text));
}

/**
 * Fingerprint a file or directory: the file's content hash, or — for a
 * directory — a hash of its sorted `name:hash` entries (recursively). A missing
 * path hashes to a sentinel so its appearance or removal changes the result.
 */
async function hashPath(path: string, host: CacheHost): Promise<string> {
  const info = await host.stat(path);
  if (info === null) return "∅"; // missing
  if (!info.isDirectory) {
    const bytes = await host.readFile(path);
    return bytes === null ? "∅" : await hashBytes(bytes);
  }
  const names = (await host.readDir(path)).slice().sort();
  const parts: string[] = [];
  for (const name of names) {
    parts.push(`${name}:${await hashPath(`${path}/${name}`, host)}`);
  }
  return hashText(parts.join("\n"));
}

/** The combined fingerprint of a target's declared inputs, in declaration order. */
export async function fingerprint(
  target: TargetBuilder,
  host: CacheHost,
): Promise<string> {
  const parts: string[] = [];
  for (const input of target.inputs_) {
    parts.push(`${input}:${await hashPath(input, host)}`);
  }
  for (const cacheKey of target.cacheKeys_) {
    parts.push(`key:${await cacheKey()}`);
  }
  return hashText(parts.join("\n"));
}

/** Whether a target participates in caching (declares inputs or cache keys). */
export function isCacheable(target: TargetBuilder): boolean {
  return target.inputs_.length > 0 || target.cacheKeys_.length > 0;
}

/** The incremental cache used by the executor to skip up-to-date targets. */
export interface BuildCache {
  /**
   * Whether `target` is up-to-date: it declares inputs, their fingerprint
   * matches the last successful run, and every declared output still exists.
   */
  upToDate(target: TargetBuilder): Promise<boolean>;
  /** Record `target`'s current fingerprint after a successful run. */
  record(target: TargetBuilder): Promise<void>;
  /** Persist the store if anything changed. */
  save(): Promise<void>;
}

/** Parse the cache store JSON into a flat name → fingerprint record. */
function parseStore(text: string | null): Record<string, string> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return {};
    const store: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") store[key] = value;
    }
    return store;
  } catch {
    return {}; // a corrupt store just means everything rebuilds
  }
}

/** Optional extras for {@link openCache}: a remote store and a warning sink. */
export interface OpenCacheOptions {
  /**
   * A {@link RemoteCacheStore} to restore outputs from (on a local miss) and
   * upload them to (after a successful run). Applies only to targets that
   * declare {@link TargetBuilder.outputs}.
   */
  remote?: RemoteCacheStore;
  /** Report a non-fatal remote-cache error (a get/put failure never fails the build). */
  warn?: (message: string) => void;
}

/** Filesystem-backed {@link BuildCache}, optionally backed by a remote store. */
class FsCache implements BuildCache {
  readonly #host: CacheHost;
  readonly #storePath: string;
  readonly #store: Record<string, string>;
  readonly #computed = new Map<TargetBuilder, string>();
  readonly #restored = new Set<TargetBuilder>();
  readonly #remote?: RemoteCacheStore;
  readonly #warn?: (message: string) => void;
  #dirty = false;

  constructor(
    host: CacheHost,
    storePath: string,
    store: Record<string, string>,
    options: OpenCacheOptions = {},
  ) {
    this.#host = host;
    this.#storePath = storePath;
    this.#store = store;
    this.#remote = options.remote;
    this.#warn = options.warn;
  }

  /** Whether every declared output of `target` still exists on disk. */
  async #outputsExist(target: TargetBuilder): Promise<boolean> {
    for (const output of target.outputs_) {
      if (await this.#host.stat(output) === null) return false;
    }
    return true;
  }

  async upToDate(target: TargetBuilder): Promise<boolean> {
    if (!isCacheable(target)) return false;
    const name = target.name_ ?? "";
    const fp = await fingerprint(target, this.#host);
    this.#computed.set(target, fp);
    if (this.#store[name] === fp && await this.#outputsExist(target)) {
      return true;
    }

    // A local miss on a target that produces outputs: try to restore them from
    // the remote store. A store error is non-fatal — fall through to a rebuild.
    if (this.#remote !== undefined && target.outputs_.length > 0) {
      const key = remoteCacheKey(name, fp);
      let artifact: Uint8Array | null = null;
      try {
        artifact = await this.#remote.get(key);
      } catch (error) {
        this.#warn?.(
          `remote cache lookup for "${name}" failed: ${messageOf(error)}`,
        );
        return false;
      }
      if (artifact !== null) {
        await restoreOutputs(artifact, this.#host);
        this.#store[name] = fp;
        this.#dirty = true;
        this.#restored.add(target);
        return true;
      }
    }
    return false;
  }

  async record(target: TargetBuilder): Promise<void> {
    if (!isCacheable(target)) return;
    const name = target.name_ ?? "";
    const fp = this.#computed.get(target) ??
      await fingerprint(target, this.#host);
    if (this.#store[name] !== fp) {
      this.#store[name] = fp;
      this.#dirty = true;
    }
    // Upload the freshly built outputs — unless we just restored them from the
    // store, in which case they are already there. Upload errors are non-fatal.
    if (
      this.#remote !== undefined && target.outputs_.length > 0 &&
      !this.#restored.has(target)
    ) {
      try {
        const artifact = await archiveOutputs(target.outputs_, this.#host);
        await this.#remote.put(remoteCacheKey(name, fp), artifact);
      } catch (error) {
        this.#warn?.(
          `remote cache upload for "${name}" failed: ${messageOf(error)}`,
        );
      }
    }
  }

  async save(): Promise<void> {
    if (!this.#dirty) return;
    await this.#host.writeStore(
      this.#storePath,
      `${JSON.stringify(this.#store, null, 2)}\n`,
    );
  }
}

/**
 * Open the incremental cache stored at `storePath`, loading any existing
 * fingerprints. Filesystem access goes through `host`; pass a
 * {@link OpenCacheOptions.remote} store to also restore and upload target
 * outputs across machines.
 */
export async function openCache(
  storePath: string,
  host: CacheHost = defaultCacheHost,
  options: OpenCacheOptions = {},
): Promise<BuildCache> {
  const store = parseStore(await host.readStore(storePath));
  return new FsCache(host, storePath, store, options);
}
