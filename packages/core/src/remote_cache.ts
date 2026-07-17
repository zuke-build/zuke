/**
 * Remote build cache: share a target's built {@link TargetBuilder.outputs}
 * across machines. The incremental {@link "./cache.ts" | cache} skips a target
 * whose inputs are unchanged *locally*; a {@link RemoteCacheStore} extends that
 * across a team and CI — a fresh checkout **restores** a target's outputs from
 * the store instead of rebuilding them, and a successful build **uploads** them
 * for the next run.
 *
 * A store is content-addressed: the key is derived from the target and its
 * input fingerprint ({@link remoteCacheKey}), and the value is a gzipped tar of
 * the target's outputs (built with the dependency-free {@link "./compression.ts"
 * | tar/gzip} helpers). Two backends ship, both dependency-free:
 * {@link FileSystemCacheStore} (a shared/mounted directory) and
 * {@link HttpCacheStore} (any object store or cache server behind a URL). A
 * build selects one with a typed `remoteCache()` override, or one is picked up
 * from the environment by {@link envCacheStore}.
 *
 * @module
 */

import { gunzip, gzip, tar, type TarEntry, untar } from "./compression.ts";
import { HttpError } from "./http.ts";

/**
 * A content-addressed store for archived target outputs, keyed by
 * {@link remoteCacheKey}. Both operations are best-effort from the build's
 * point of view: the executor never fails a build because the store is
 * unreachable — it just rebuilds and, where it can, re-uploads.
 */
export interface RemoteCacheStore {
  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  get(key: string): Promise<Uint8Array | null>;
  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  put(key: string, artifact: Uint8Array): Promise<void>;
}

/** Filesystem effects used to archive and restore a target's outputs. */
export interface OutputHost {
  /** File contents, or `null` if the path does not exist. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Whether a path exists and is a directory, or `null` if it is missing. */
  stat(path: string): Promise<{ isDirectory: boolean } | null>;
  /** The entry names within a directory. */
  readDir(path: string): Promise<string[]>;
  /** Write a file, creating parent directories as needed. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

/** Normalise a path for archive entry names: `\`→`/`, drop a leading `./`. */
function normalize(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/**
 * Collect every file under `outputs` (directories walked recursively) as tar
 * entries named by their normalised path, sorted so the archive is reproducible.
 */
async function collectEntries(
  outputs: readonly string[],
  host: OutputHost,
): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  const walk = async (path: string): Promise<void> => {
    const info = await host.stat(path);
    if (info === null) return; // a declared output that isn't there — skip it
    if (!info.isDirectory) {
      const data = await host.readFile(path);
      if (data !== null) entries.push({ name: normalize(path), data });
      return;
    }
    for (const name of (await host.readDir(path)).slice().sort()) {
      await walk(`${path}/${name}`);
    }
  };
  for (const output of outputs) await walk(normalize(output));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/** Archive a target's `outputs` into a gzipped tar of their current contents. */
export async function archiveOutputs(
  outputs: readonly string[],
  host: OutputHost,
): Promise<Uint8Array> {
  return await gzip(tar(await collectEntries(outputs, host)));
}

/**
 * Reject an archive entry whose name would escape the workspace — an absolute
 * path or one containing a `..` segment. A remote store is only as trustworthy
 * as whoever can write to it, so a poisoned or malicious archive must never be
 * able to place files outside the current directory (a "zip slip").
 */
function assertSafeEntryName(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(
      `remote cache: refusing to restore an absolute path from an archive: "${name}".`,
    );
  }
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(
      `remote cache: refusing to restore a path that escapes the workspace: "${name}".`,
    );
  }
}

/**
 * Restore the files in `artifact` (a gzipped tar produced by
 * {@link archiveOutputs}) to disk, returning the paths written. Entry names are
 * validated first: an absolute path or one escaping the workspace (`..`) is
 * rejected before anything is written, so a malicious archive can't plant files
 * outside the current directory.
 */
export async function restoreOutputs(
  artifact: Uint8Array,
  host: OutputHost,
): Promise<string[]> {
  const entries = untar(await gunzip(artifact));
  // Validate every entry up front so a bad name aborts the whole restore
  // instead of leaving a half-written, partially-trusted output tree.
  for (const entry of entries) assertSafeEntryName(entry.name);
  const written: string[] = [];
  for (const entry of entries) {
    await host.writeFile(entry.name, entry.data);
    written.push(entry.name);
  }
  return written;
}

/**
 * The store key for a target's outputs: its name and input `fingerprint`. The
 * name is sanitised so the key is safe as a filename and a URL path segment.
 */
export function remoteCacheKey(name: string, fingerprint: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe}-${fingerprint}`;
}

/** A {@link RemoteCacheStore} backed by a shared or mounted directory. */
export class FileSystemCacheStore implements RemoteCacheStore {
  readonly #dir: string;

  /**
   * Build the store over a directory.
   *
   * @param dir The directory archives are read from and written to.
   */
  constructor(dir: string) {
    this.#dir = dir;
  }

  #path(key: string): string {
    return `${this.#dir}/${key}.tar.gz`;
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  get(key: string): Promise<Uint8Array | null> {
    return readFileOrNull(this.#path(key));
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  async put(key: string, artifact: Uint8Array): Promise<void> {
    await Deno.mkdir(this.#dir, { recursive: true });
    await Deno.writeFile(this.#path(key), artifact);
  }
}

/** Read a file's bytes, or `null` when it does not exist. */
async function readFileOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Configuration for an {@link HttpCacheStore}. */
export interface HttpCacheStoreOptions {
  /** The base URL keys are appended to (any trailing slash is ignored). */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/**
 * A {@link RemoteCacheStore} backed by HTTP: `GET <url>/<key>` fetches an
 * artifact (a `404` means a miss) and `PUT <url>/<key>` stores one. Works with
 * any object store or cache server that speaks plain HTTP GET/PUT — an S3, GCS,
 * or R2 bucket behind a URL, or a self-hosted cache endpoint.
 *
 * **Security.** The `url` (and `token`) are *trusted configuration*: outputs are
 * uploaded to that host and archives are extracted from it, so point it only at
 * a cache you control, and prefer a {@link "./params.ts" | secret parameter} or
 * an environment variable over a hard-coded value. On CI, restrict egress to
 * the cache host so a misconfigured or overridden URL can't exfiltrate
 * artifacts. Restored archives are always confined to the workspace (see
 * {@link restoreOutputs}), so a poisoned store cannot write outside it.
 */
export class HttpCacheStore implements RemoteCacheStore {
  readonly #base: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;

  /** Build the store from its URL, optional token, and `fetch` seam. */
  constructor(options: HttpCacheStoreOptions) {
    this.#base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  #url(key: string): string {
    return `${this.#base}/${encodeURIComponent(key)}`;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.#token !== undefined && this.#token !== "") {
      headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  async get(key: string): Promise<Uint8Array | null> {
    const url = this.#url(key);
    const response = await this.#fetch(url, { headers: this.#headers() });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  async put(key: string, artifact: Uint8Array): Promise<void> {
    const url = this.#url(key);
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: this.#headers({ "content-type": "application/octet-stream" }),
      // Copy into a fresh ArrayBuffer-backed Blob so the body type is unambiguous
      // regardless of the source buffer (e.g. a SharedArrayBuffer).
      body: new Blob([new Uint8Array(artifact)]),
    });
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, url);
  }
}

/**
 * Resolve a {@link RemoteCacheStore} from the environment, or `undefined` when
 * none is configured. `ZUKE_REMOTE_CACHE_URL` (with an optional
 * `ZUKE_REMOTE_CACHE_TOKEN`) selects an {@link HttpCacheStore}; otherwise
 * `ZUKE_REMOTE_CACHE_DIR` selects a {@link FileSystemCacheStore}.
 */
export function envCacheStore(
  readEnv: (name: string) => string | undefined,
): RemoteCacheStore | undefined {
  const url = readEnv("ZUKE_REMOTE_CACHE_URL");
  if (url !== undefined && url !== "") {
    return new HttpCacheStore({
      url,
      token: readEnv("ZUKE_REMOTE_CACHE_TOKEN"),
    });
  }
  const dir = readEnv("ZUKE_REMOTE_CACHE_DIR");
  if (dir !== undefined && dir !== "") return new FileSystemCacheStore(dir);
  return undefined;
}

/**
 * Pick the remote store for a run by precedence: an explicit `option` wins
 * (`false` disables the remote cache entirely), then a `declared` store (a
 * build's `remoteCache()` override), then the {@link envCacheStore} environment
 * fallback.
 */
export function resolveRemoteStore(
  option: RemoteCacheStore | false | undefined,
  declared: RemoteCacheStore | undefined,
  readEnv: (name: string) => string | undefined,
): RemoteCacheStore | undefined {
  if (option === false) return undefined;
  if (option !== undefined) return option;
  return declared ?? envCacheStore(readEnv);
}
