// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

import {
  assertSafeEntryName,
  findSymlinkAncestor,
  gunzipBounded,
  gzip,
  type LinkProbe,
  tar,
  type TarEntry,
  untar,
} from "./compression.ts";
import { assertSecureBackendUrl, HttpError } from "./http.ts";
import { readBytesBounded, readFileOrNull } from "./internal.ts";

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

/**
 * How many bytes of a fetched artifact the cache will read off the wire before
 * refusing it. Far above any real target's compressed outputs, and a refusal is
 * a warned rebuild rather than a failure, so the cost of the cap being wrong is
 * one slow build.
 */
const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

/**
 * How much a fetched artifact may *decompress* to before it is refused.
 *
 * Deliberately larger than {@link DEFAULT_MAX_ARTIFACT_BYTES}: build outputs
 * compress, so a legitimate archive routinely inflates several times over, and
 * a bound equal to the on-the-wire one would refuse real artifacts. A
 * decompression bomb overshoots this by orders of magnitude, so the headroom
 * costs nothing.
 */
const DEFAULT_MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024;

/** Filesystem effects used to archive and restore a target's outputs. */
export interface OutputHost {
  /** File contents, or `null` if the path does not exist. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Whether a path exists and is a directory, or `null` if it is missing. */
  stat(path: string): Promise<{ isDirectory: boolean } | null>;
  /**
   * Describe a path *without* following a final symlink, or `null` if it is
   * missing. Distinct from {@link OutputHost.stat}, which resolves a link and so
   * cannot see one: {@link restoreOutputs} refuses to write *through* a link,
   * which is a question only an `lstat` can answer.
   */
  lstat(
    path: string,
  ): Promise<{ isSymlink: boolean; isDirectory: boolean } | null>;
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
 * Paths through a {@link FORBIDDEN_DIRS} directory are skipped, mirroring what
 * {@link restoreOutputs} refuses to write back.
 */
async function collectEntries(
  outputs: readonly string[],
  host: OutputHost,
): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  const walk = async (path: string): Promise<void> => {
    // Never archive what restore would refuse to write back (see
    // {@link FORBIDDEN_DIRS}): uploading a `.git` to a shared store would leak
    // its history and leave the target permanently un-restorable.
    if (isForbiddenPath(normalize(path))) return;
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

/**
 * Archive a target's `outputs` into a gzipped tar of their current contents.
 * A declared output that does not exist is skipped, as is anything under a
 * `.git` or `.zuke` directory.
 */
export async function archiveOutputs(
  outputs: readonly string[],
  host: OutputHost,
): Promise<Uint8Array> {
  return await gzip(tar(await collectEntries(outputs, host)));
}

/**
 * Directory names no restored entry may pass through, whatever a target declares
 * as an output. `.git` is the one that turns a poisoned cache into code
 * execution: a restored `.git/hooks/pre-commit` or a rewritten `.git/config`
 * runs on the developer's next ordinary git command. `.zuke` holds the run state
 * and cache index Zuke itself trusts.
 */
const FORBIDDEN_DIRS = [".git", ".zuke"];

/**
 * Whether any segment of `name` (already normalised) is a
 * {@link FORBIDDEN_DIRS} entry. Matched per segment rather than as a prefix,
 * because a nested one is just as dangerous: a submodule's `sub/.git/hooks/…`
 * runs on the same ordinary git command the top-level one would.
 */
function isForbiddenPath(name: string): boolean {
  return name.toLowerCase().split("/").some((segment) =>
    FORBIDDEN_DIRS.includes(segment)
  );
}

/**
 * Whether `name` (already normalised) is one of `outputs`, or nested under one.
 * A declared output of `.` — the whole workspace — matches everything, which is
 * what declaring it asked for.
 */
function isDeclaredOutput(name: string, outputs: readonly string[]): boolean {
  return outputs.some((output) => {
    const root = normalize(output).replace(/\/+$/, "");
    if (root === "" || root === ".") return true;
    return name === root || name.startsWith(`${root}/`);
  });
}

/**
 * Reject an archive entry that a legitimate {@link archiveOutputs} could not
 * have produced: a symlink or a directory entry. Neither is ever archived —
 * {@link collectEntries} emits regular files only — so their presence means the
 * archive was built by something else, and restoring a symlink is how a later
 * entry writes through it to a path the name checks approved.
 */
function assertPlainFileEntry(entry: TarEntry): void {
  if (entry.linkname !== undefined) {
    throw new Error(
      `remote cache: refusing to restore a symlink from an archive: "${entry.name}".`,
    );
  }
  if (entry.name.endsWith("/")) {
    throw new Error(
      `remote cache: refusing to restore a directory entry from an archive: "${entry.name}".`,
    );
  }
}

/**
 * Restore the files in `artifact` (a gzipped tar produced by
 * {@link archiveOutputs}) to disk, returning the paths written.
 *
 * Every entry is validated before anything is written, so a rejected archive
 * leaves no half-written, partially-trusted output tree. An entry is refused
 * when its name is absolute or escapes the workspace with `..`, when it is a
 * symlink or directory entry (which {@link archiveOutputs} never produces),
 * when it lands under `.git` or `.zuke`, when — given `outputs` — it falls
 * outside the target's declared outputs, and when the path it would be written
 * to passes through, or is, a symlink that already exists on disk.
 *
 * That last refusal is what makes the confinement real rather than lexical. The
 * archive cannot plant a link, but a workspace can already hold one at a
 * declared output — `dist -> /tmp/build`, a checked-out `bazel-bin`, a Windows
 * junction — and `writeFile` follows it. Such a workspace no longer restores
 * from the remote cache and rebuilds instead; the link is left alone, because
 * the layout is the owner's and silently replacing it would be its own
 * surprise.
 *
 * @param maxBytes The most the artifact may decompress to before it is refused,
 *   defaulting to 2 GiB. The bound is applied *while* decompressing, so a small
 *   archive that expands without limit is refused rather than buffered first.
 *   It is larger than the bound a store puts on the compressed bytes because
 *   outputs compress; both exist to stop memory exhaustion.
 *
 * @param outputs The declaring target's {@link TargetBuilder.outputs}. Pass them
 *   whenever they are known, which is what the executor does: an archive built
 *   from those outputs can only contain paths under them, so anything else is a
 *   store that has been written to by something other than a Zuke build, and
 *   restoring it would let that writer choose files anywhere in the workspace —
 *   a `deno.json`, a lockfile, a script a later target runs. Omitting them keeps
 *   the older, name-only confinement for a caller that has no output list.
 */
export async function restoreOutputs(
  artifact: Uint8Array,
  host: OutputHost,
  outputs?: readonly string[],
  maxBytes: number = DEFAULT_MAX_INFLATED_BYTES,
): Promise<string[]> {
  const inflated = await gunzipBounded(artifact, maxBytes);
  if (inflated === null) {
    throw new Error(
      `remote cache: refusing an artifact that decompresses to more than ` +
        `${maxBytes} bytes.`,
    );
  }
  const entries = untar(inflated);
  // Every ancestor confirmed to be a plain directory, so a deep output tree is
  // not re-probed once per file. Restore writes nothing during this pass, so
  // nothing can invalidate an entry in it — unlike the extractor, which creates
  // as it goes and must evict.
  const realDirs = new Set<string>(["."]);
  const probe: LinkProbe = (path) => host.lstat(normalize(path));
  const validated: { name: string; data: Uint8Array }[] = [];
  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    assertPlainFileEntry(entry);
    const name = normalize(entry.name);
    if (isForbiddenPath(name)) {
      throw new Error(
        `remote cache: refusing to restore into a protected path: "${entry.name}".`,
      );
    }
    if (outputs !== undefined && !isDeclaredOutput(name, outputs)) {
      throw new Error(
        `remote cache: refusing to restore "${entry.name}", which is outside ` +
          `the target's declared outputs (${outputs.join(", ")}).`,
      );
    }
    // The checks above are lexical — they reason about the entry's name. These
    // two ask the filesystem what is already there, because `writeFile` follows
    // a symlink: one the archive cannot have planted (a link entry is refused
    // above), but one the workspace may already hold at a declared output.
    const through = await findSymlinkAncestor(probe, ".", name, realDirs);
    if (through !== null) {
      throw new Error(
        `remote cache: refusing to restore "${entry.name}" through the ` +
          `symlink "${through}" — restoring would write outside the workspace. ` +
          `Replace the link with a real directory to cache this target.`,
      );
    }
    if ((await host.lstat(name))?.isSymlink === true) {
      throw new Error(
        `remote cache: refusing to restore over the symlink "${entry.name}" — ` +
          `writing would follow it outside the workspace. Replace the link ` +
          `with a real file to cache this target.`,
      );
    }
    validated.push({ name, data: entry.data });
  }
  // Write the *validated* path rather than the raw entry name. Every check
  // above reasoned about the normalised form, and a name that differs from it
  // — a literal backslash, legal on POSIX; a leading `./` — would otherwise be
  // checked at one path and written at another, which is exactly the gap a
  // guard must not have. `archiveOutputs` normalises on the way in, so for an
  // archive Zuke produced the two are the same string.
  const written: string[] = [];
  for (const entry of validated) {
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

/** Configuration for an {@link HttpCacheStore}. */
export interface HttpCacheStoreOptions {
  /** The base URL keys are appended to (any trailing slash is ignored). */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
  /**
   * The most a fetched artifact may weigh on the wire, in bytes, before it is
   * refused. Defaults to 512 MiB. Raise it for a target whose compressed
   * outputs are genuinely larger; a refusal is a warned rebuild, not a build
   * failure. What the bytes *decompress* to is bounded separately, by
   * {@link restoreOutputs}.
   */
  maxArtifactBytes?: number;
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
 * artifacts. A restored archive cannot name a path outside the workspace, cannot
 * carry a link or directory entry, and is refused if the path it would land on
 * passes through a symlink the workspace already holds — so a poisoned store
 * cannot write outside the workspace (see {@link restoreOutputs}). An artifact
 * larger than {@link HttpCacheStoreOptions.maxArtifactBytes} is refused before
 * it is buffered, and {@link restoreOutputs} separately bounds what it
 * decompresses to.
 */
export class HttpCacheStore implements RemoteCacheStore {
  readonly #base: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;
  readonly #maxArtifactBytes: number;

  /** Build the store from its URL, optional token, size cap, and `fetch` seam. */
  constructor(options: HttpCacheStoreOptions) {
    this.#base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#maxArtifactBytes = options.maxArtifactBytes ??
      DEFAULT_MAX_ARTIFACT_BYTES;
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
    // Read against the cap rather than buffering whole and measuring after: a
    // store that answers with an endless body would otherwise exhaust memory
    // before there was anything to reject.
    const bytes = await readBytesBounded(response.body, this.#maxArtifactBytes);
    if (bytes === null) {
      throw new Error(
        `remote cache: refusing an artifact larger than ` +
          `${this.#maxArtifactBytes} bytes from ${url}.`,
      );
    }
    return bytes;
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
    assertSecureBackendUrl(url, "ZUKE_REMOTE_CACHE_URL", readEnv);
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
