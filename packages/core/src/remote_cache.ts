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
 * {@link HttpCacheStore} (any object store or cache server behind a URL); a
 * third, {@link "./s3_cache.ts".S3CacheStore}, signs the HTTP store's requests
 * for S3-compatible object storage, and a fourth,
 * {@link "./github_actions_cache.ts".GitHubActionsCacheStore}, uses the
 * GitHub Actions cache service a job already holds credentials for. A build
 * selects one with a typed `remoteCache()` override, or one is picked up from
 * the environment by {@link envCacheStore}.
 *
 * @module
 */

import {
  assertSafeEntryName,
  assertSafeLinkTarget,
  byteStream,
  findSymlinkAncestor,
  gunzipStreamBounded,
  gzipTarStream,
  type LinkProbe,
  type TarEntry,
  untarStream,
} from "./compression.ts";
import { GitHubActionsCacheStore } from "./github_actions_cache.ts";
import { artifactBody, assertSecureBackendUrl, HttpError } from "./http.ts";
import { messageOf } from "./internal.ts";
import { redactUrl } from "./redact_url.ts";
import type { AwsCredentials } from "./aws_sigv4.ts";
import { S3CacheStore } from "./s3_cache.ts";

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
  /**
   * {@link RemoteCacheStore.get} as a stream, or `null` if there is nothing
   * under `key`: the executor writes it straight to a temporary file and
   * restores from there, so a large artifact is never held in memory. A store
   * without it is read with `get`.
   */
  getStream?(
    key: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null>;
  /**
   * {@link RemoteCacheStore.put} from a stream, so the archive is written as
   * it is compressed rather than buffered first. A store without it is given
   * the whole artifact through `put`.
   */
  putStream?(
    key: string,
    artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<void>;
  /**
   * The most an artifact from this store may decompress to, in bytes, before
   * {@link restoreOutputs} refuses it. Defaults to 2 GiB; raise it for a target
   * whose outputs are genuinely larger, such as a whole SDK. The restore streams
   * the inflated archive rather than holding it, so raising the bound does not
   * raise its memory use.
   */
  readonly maxInflatedBytes?: number;
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
  /**
   * Whether a path exists and is a directory, or `null` if it is missing. A
   * host that has permission bits reports them as `mode`, so an archived
   * binary is restored executable; one that does not (Windows, a test double)
   * leaves it out and the entry takes the archive's default.
   */
  stat(path: string): Promise<{ isDirectory: boolean; mode?: number } | null>;
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
  /**
   * Write a file, creating parent directories as needed, with the permission
   * bits `mode` where the platform has them.
   */
  writeFile(path: string, bytes: Uint8Array, mode?: number): Promise<void>;
  /**
   * The raw target of the symlink at `path`. A host without it archives every
   * link as a copy of what it points at, as older Zuke releases did.
   */
  readLink?(path: string): Promise<string>;
  /**
   * Create a symlink at `path` pointing at `target`, creating parent
   * directories as needed. `type` is what Windows needs to know and POSIX
   * ignores. A host without it refuses an archive that carries a link, so the
   * target rebuilds.
   */
  symlink?(target: string, path: string, type: "file" | "dir"): Promise<void>;
  /**
   * The canonical path of `path`, every symlink resolved. Lets the archive walk
   * notice a directory link that loops back to a directory it is already
   * inside; a host without it cannot, and such a loop recurses until the OS
   * refuses the path.
   */
  realPath?(path: string): Promise<string>;
}

/** Normalise a path for archive entry names: `\`→`/`, drop a leading `./`. */
function normalize(path: string): string {
  // Empty and `.` segments are dropped, not kept: the filesystem collapses
  // them, so a check that counted `dist//x` as two levels deep would let a
  // link's `..` climb one level further than it allows.
  const segments = path.replace(/\\/g, "/").split("/").filter((segment) =>
    segment !== "" && segment !== "."
  );
  return segments.length === 0 ? "." : segments.join("/");
}

/** A declared output as the root its entries are confined to: `.` for the workspace. */
function outputRoot(output: string): string {
  return normalize(output);
}

/** The workspace path a relative link `target` at `name` resolves to, lexically. */
function resolveLink(name: string, target: string): string {
  const parts = name.split("/").slice(0, -1);
  for (const segment of target.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.length === 0 ? "." : parts.join("/");
}

/**
 * Why the link at `name` (normalised) to `target` may not be kept as a link
 * inside the output `root`, or `null` when it may: its target must be relative,
 * stay inside `root` ({@link assertSafeLinkTarget}, applied with `root` as the
 * extraction root, so `..` may not follow a name), and not resolve through a
 * {@link FORBIDDEN_DIRS} directory. The one rule both sides apply, so an archive
 * never carries a link its own restore would refuse.
 */
function linkRefusal(
  name: string,
  target: string,
  root: string,
): string | null {
  // A link that *is* the output root points away from it, wherever it points.
  if (name === root) return `the symlink "${name}" is the output itself.`;
  const relative = root === "." ? name : name.slice(root.length + 1);
  try {
    assertSafeLinkTarget(relative, target);
  } catch (error) {
    return messageOf(error);
  }
  return isForbiddenPath(resolveLink(name, target))
    ? `the symlink "${name}" points into a protected path: "${target}".`
    : null;
}

/** An archive entry before its file is read: a file's name and mode, or a link. */
type PlannedEntry = Omit<TarEntry, "data">;

/**
 * List every file under `outputs` (directories walked recursively) as archive
 * entries named by their normalised path, sorted so the archive is
 * reproducible. Files are listed, not read: {@link archiveOutputs} reads each
 * one only as it is streamed into the archive.
 * Paths through a {@link FORBIDDEN_DIRS} directory are skipped, mirroring what
 * {@link restoreOutputs} refuses to write back.
 *
 * A symlink whose relative target stays inside the declared output it was found
 * under ({@link linkRefusal}) is archived as a link, so `node_modules/.bin/tsc
 * -> ../typescript/bin/tsc` keeps resolving its relative imports after a
 * restore. Any other link is archived as a copy of what it points at.
 */
async function collectEntries(
  outputs: readonly string[],
  host: OutputHost,
): Promise<PlannedEntry[]> {
  // By name: nested outputs reach the same path twice, and a link kept under
  // one root must not also arrive as a copy from the other — restore refuses a
  // name that is both.
  const byName = new Map<string, PlannedEntry>();
  const add = (entry: PlannedEntry): void => {
    if (byName.get(entry.name)?.linkname === undefined) {
      byName.set(entry.name, entry);
    }
  };
  // The real directories on the current walk path — only the path, so two
  // links to one directory are still both copied, as without a loop.
  const onPath = new Set<string>();
  const walk = async (raw: string, root: string): Promise<void> => {
    const path = normalize(raw);
    // Never archive what restore would refuse to write back (see
    // {@link FORBIDDEN_DIRS}): uploading a `.git` to a shared store would leak
    // its history and leave the target permanently un-restorable.
    if (isForbiddenPath(path) || isInstallMarker(path)) return;
    if (host.readLink !== undefined && (await host.lstat(path))?.isSymlink) {
      const target = (await host.readLink(path)).replace(/\\/g, "/");
      if (linkRefusal(path, target, root) === null) {
        add({ name: path, linkname: target });
        return;
      }
    }
    const info = await host.stat(path);
    if (info === null) return; // a declared output that isn't there — skip it
    if (!info.isDirectory) {
      // Permission bits only: the tar header has no room for a file type, and
      // the executable bit is what a restored binary needs to keep.
      const mode = info.mode === undefined ? undefined : info.mode & 0o777;
      add({ name: path, mode });
      return;
    }
    // A copied directory link can lead back to a directory this walk is
    // already inside; entering it again would copy the tree once per level.
    const real = await host.realPath?.(path);
    if (real !== undefined && onPath.has(real)) return;
    if (real !== undefined) onPath.add(real);
    for (const name of (await host.readDir(path)).slice().sort()) {
      await walk(`${path}/${name}`, root);
    }
    if (real !== undefined) onPath.delete(real);
  };
  for (const output of outputs) {
    await walk(output, outputRoot(output));
  }
  return [...byName.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
}

/**
 * Archive a target's `outputs` into a gzipped tar of their current contents,
 * each file with its permission bits so a binary restores executable. A
 * declared output that does not exist is skipped, as is anything under a
 * `.git` or `.zuke` directory, other than `.zuke/tools` and whatever it holds.
 *
 * Each file is read only when the compressor asks for it, so what is held in
 * memory is the compressed archive plus the one file being added — not the
 * whole tree, which for a `node_modules` runs to gigabytes.
 */
export async function archiveOutputs(
  outputs: readonly string[],
  host: OutputHost,
): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(await archiveStream(outputs, host)).arrayBuffer(),
  );
}

/**
 * {@link archiveOutputs} as a stream of the gzipped archive, for a store that
 * writes it as it is produced ({@link RemoteCacheStore.putStream}).
 */
export async function archiveStream(
  outputs: readonly string[],
  host: OutputHost,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const planned = await collectEntries(outputs, host);
  async function* read(): AsyncGenerator<TarEntry> {
    for (const entry of planned) {
      if (entry.linkname !== undefined) {
        yield { ...entry, data: new Uint8Array(0) };
        continue;
      }
      const data = await host.readFile(entry.name);
      // Gone since the walk listed it: skipped, as a missing output is.
      if (data !== null) yield { ...entry, data };
    }
  }
  return gzipTarStream(read());
}

/**
 * Directory names no restored entry may pass through, whatever a target declares
 * as an output. `.git` is the one that turns a poisoned cache into code
 * execution: a restored `.git/hooks/pre-commit` or a rewritten `.git/config`
 * runs on the developer's next ordinary git command. `.zuke` holds the run state
 * and cache index Zuke itself trusts — except its `tools` subtree, where a
 * build's declared toolchain installs the binaries it provisions. Those are
 * exactly the outputs a remote cache exists to share (a pinned SDK, a
 * checksum-verified scanner). A restored binary is trusted as the store
 * delivered it — the provisioning target that would have verified it is
 * skipped as a cache hit — so only a signing key
 * (`ZUKE_REMOTE_CACHE_SIGNING_KEY`) authenticates it. The install markers that
 * let a later install skip its download are never archived or restored
 * ({@link isInstallMarker}), so they cannot vouch for a restored binary.
 *
 * A `.git` *inside* that subtree is allowed too: an SDK such as Flutter's is a
 * git checkout that runs `git` on itself, so it is broken without one. That
 * grants a store nothing new — it can already replace the SDK's own binaries
 * and scripts there — and the workspace's own `.git`, or any outside
 * `.zuke/tools`, stays refused.
 */
const FORBIDDEN_DIRS = [".git", ".zuke"];

/** The one `.zuke` subtree a restore may write into: see {@link FORBIDDEN_DIRS}. */
const TOOLS_DIR = "tools";

/**
 * Whether any segment of `name` (already normalised) is a
 * {@link FORBIDDEN_DIRS} entry. Matched per segment rather than as a prefix,
 * because a nested one is just as dangerous: a submodule's `sub/.git/hooks/…`
 * runs on the same ordinary git command the top-level one would.
 */
function isForbiddenPath(name: string): boolean {
  // Windows drops a segment's trailing dots and spaces, so `.git.` is `.git`.
  const segments = name.toLowerCase().split("/").map((segment) =>
    segment.replace(/[. ]+$/, "")
  );
  const tools = segments.findIndex((segment, i) =>
    segment === ".zuke" && segments[i + 1] === TOOLS_DIR
  );
  return segments.some((segment, i) =>
    FORBIDDEN_DIRS.includes(segment) &&
    !(segment === ".zuke" && segments[i + 1] === TOOLS_DIR) &&
    !(segment === ".git" && tools !== -1 && tools < i)
  );
}

/**
 * Whether `name` (normalised) is an install marker — `<bin>.install.json`,
 * `<tree>.tree.json` or `.zuke-npm-tool.json` — the local record that lets an
 * install skip its download. A marker is evidence only when this machine wrote
 * it after verifying the download, so one is never archived, and one in an
 * archive is refused: restored beside a swapped binary it would vouch for it.
 */
function isInstallMarker(name: string): boolean {
  // Lowercased and trailing dots/spaces dropped, as Windows resolves the name.
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase()
    .replace(/[. ]+$/, "");
  return base.endsWith(".install.json") || base.endsWith(".tree.json") ||
    base === ".zuke-npm-tool.json";
}

/**
 * Whether `name` (already normalised) is one of `outputs`, or nested under one.
 * A declared output of `.` — the whole workspace — matches everything, which is
 * what declaring it asked for.
 */
function isDeclaredOutput(name: string, outputs: readonly string[]): boolean {
  return outputs.some((output) => isUnder(name, outputRoot(output)));
}

/** Whether `name` is `root` or nested under it; everything is under `.`. */
function isUnder(name: string, root: string): boolean {
  return root === "." || name === root || name.startsWith(`${root}/`);
}

/**
 * Reject a symlink entry {@link archiveOutputs} could not have produced: one
 * whose target leaves every declared output root that holds it (the whole
 * workspace when `outputs` is not given), or resolves into a protected path.
 */
function assertKeepableLink(
  name: string,
  target: string,
  outputs: readonly string[] | undefined,
): void {
  const roots = (outputs ?? ["."]).map(outputRoot).filter((root) =>
    isUnder(name, root)
  );
  let refusal = "it is outside the declared outputs.";
  for (const root of roots) {
    const reason = linkRefusal(name, target, root);
    if (reason === null) return;
    refusal = reason;
  }
  throw new Error(
    `remote cache: refusing to restore the symlink "${name}": ${refusal}`,
  );
}

/**
 * Reject an archive entry that a legitimate {@link archiveOutputs} could not
 * have produced: a directory entry. {@link collectEntries} emits regular files
 * and symlinks only; a symlink is checked on its own by
 * {@link assertKeepableLink}.
 */
function assertNoDirectoryEntry(entry: TarEntry): void {
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
 * directory entry (which {@link archiveOutputs} never produces), when it lands
 * under `.git` or `.zuke` (`.zuke/tools` aside), when it is an install marker
 * ({@link isInstallMarker}), when — given `outputs` — it
 * falls outside the target's declared outputs, and when the path it would be
 * written to passes through, or is, a symlink that already exists on disk.
 *
 * A symlink entry is restored only when its target is relative, stays inside
 * a declared output root that holds the link (with `..` only before the
 * target's first name), and does not resolve into `.git` or `.zuke`; when no
 * other entry shares its name or sits under it; and when the host can create
 * links at all. Links are created after every file is written, so no write can
 * pass through one.
 *
 * The on-disk refusal is what makes the confinement real rather than lexical.
 * The archive cannot plant a link that a write follows, but a workspace can already hold one at a
 * declared output — `dist -> /tmp/build`, a checked-out `bazel-bin`, a Windows
 * junction — and `writeFile` follows it. Such a workspace no longer restores
 * from the remote cache and rebuilds instead; the link is left alone, because
 * the layout is the owner's and silently replacing it would be its own
 * surprise.
 *
 * @param maxBytes The most the artifact may decompress to before it is refused,
 *   defaulting to 2 GiB; the executor passes the store's
 *   {@link RemoteCacheStore.maxInflatedBytes}. The bound is applied *while* decompressing, so a small
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
  return await restoreFrom(
    () => Promise.resolve(byteStream(artifact)),
    host,
    outputs,
    maxBytes,
  );
}

/**
 * {@link restoreOutputs} from an artifact that `open` can read more than
 * once — a spooled download, so the compressed bytes need not be in memory.
 * Each call to `open` must yield the same bytes.
 */
export async function restoreFrom(
  open: () => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>,
  host: OutputHost,
  outputs?: readonly string[],
  maxBytes: number = DEFAULT_MAX_INFLATED_BYTES,
): Promise<string[]> {
  // A NaN bound would disable the check (`total > NaN` is never true).
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(
      `remote cache: maxInflatedBytes must be a positive whole number of ` +
        `bytes, got ${maxBytes}.`,
    );
  }
  // Inflated twice, as a stream each time, so the decompressed archive is never
  // held whole: the first pass reads only headers and validates every entry,
  // the second writes them one file at a time. Writing nothing until all of
  // it is validated is what keeps a refused archive from leaving a
  // half-written, partially-trusted output tree.
  const inflate = async () =>
    gunzipStreamBounded(
      await open(),
      maxBytes,
      () =>
        new Error(
          `remote cache: refusing an artifact that decompresses to more than ` +
            `${maxBytes} bytes.`,
        ),
    );
  // Every ancestor confirmed to be a plain directory, so a deep output tree is
  // not re-probed once per file. Restore writes nothing during this pass, so
  // nothing can invalidate an entry in it — unlike the extractor, which creates
  // as it goes and must evict.
  const realDirs = new Set<string>(["."]);
  const probe: LinkProbe = (path) => host.lstat(normalize(path));
  const validated: TarEntry[] = [];
  for await (const entry of untarStream(await inflate(), false)) {
    assertSafeEntryName(entry.name);
    assertNoDirectoryEntry(entry);
    const name = normalize(entry.name);
    if (isForbiddenPath(name)) {
      throw new Error(
        `remote cache: refusing to restore into a protected path: "${entry.name}".`,
      );
    }
    if (isInstallMarker(name)) {
      throw new Error(
        `remote cache: refusing to restore the install marker "${entry.name}".`,
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
    if (entry.linkname === undefined) {
      validated.push({ name, data: entry.data, mode: entry.mode });
    } else {
      const linkname = entry.linkname.replace(/\\/g, "/");
      assertKeepableLink(name, linkname, outputs);
      validated.push({ name, data: entry.data, linkname });
    }
  }
  assertNothingUnderALink(validated);
  if (
    host.symlink === undefined &&
    validated.some((e) => e.linkname !== undefined)
  ) {
    throw new Error(
      `remote cache: refusing an archive with symlinks: this host cannot ` +
        `create them.`,
    );
  }
  // Write the *validated* path rather than the raw entry name. Every check
  // above reasoned about the normalised form, and a name that differs from it
  // — a literal backslash, legal on POSIX; a leading `./` — would otherwise be
  // checked at one path and written at another, which is exactly the gap a
  // guard must not have. `archiveOutputs` normalises on the way in, so for an
  // archive Zuke produced the two are the same string.
  // Every file before any link, so no write can pass through a link the
  // archive planted — on top of {@link assertNothingUnderALink}, which already
  // refuses an entry nested under one.
  // Each file the second pass reads is written under the name, and with the
  // mode, the first pass validated — looked up by name, not by position, so
  // the write never depends on the two passes reading in lockstep.
  const files = new Map(
    validated.filter((entry) => entry.linkname === undefined).map((
      entry,
    ) => [entry.name, entry]),
  );
  const written: string[] = [];
  for await (const read of untarStream(await inflate(), true)) {
    if (read.linkname !== undefined) continue;
    const entry = files.get(normalize(read.name));
    if (entry === undefined) {
      throw new Error(
        `remote cache: refusing "${read.name}", which the validation pass ` +
          `did not see.`,
      );
    }
    await host.writeFile(entry.name, read.data, entry.mode);
    written.push(entry.name);
  }
  for (const entry of validated) {
    if (entry.linkname === undefined || host.symlink === undefined) continue;
    // Ask the live filesystem again, now that earlier links exist: on a
    // case-insensitive one, `out/s/h` passes through a just-created `out/S`
    // that no name comparison could see.
    const through = await findSymlinkAncestor(
      probe,
      ".",
      entry.name,
      new Set(["."]),
    );
    if (through !== null) {
      throw new Error(
        `remote cache: refusing to create the symlink "${entry.name}" ` +
          `through the symlink "${through}".`,
      );
    }
    // shortcut: a link to a link not yet created is typed "file"; only Windows
    // cares, and npm writes `.cmd` shims there rather than links.
    const resolved = await host.stat(resolveLink(entry.name, entry.linkname));
    await host.symlink(
      entry.linkname,
      entry.name,
      resolved?.isDirectory === true ? "dir" : "file",
    );
    written.push(entry.name);
  }
  return written;
}

/**
 * Refuse a link that shares its name with another entry, or that another entry
 * sits under: either would have a write land through, or on top of, a link the
 * archive planted. {@link collectEntries} never produces either.
 */
function assertNothingUnderALink(entries: readonly TarEntry[]): void {
  const links = new Set<string>();
  for (const entry of entries) {
    if (entry.linkname === undefined) continue;
    if (links.has(entry.name)) {
      throw new Error(
        `remote cache: refusing an archive with the symlink "${entry.name}" twice.`,
      );
    }
    links.add(entry.name);
  }
  for (const entry of entries) {
    const parts = entry.name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (links.has(ancestor)) {
        throw new Error(
          `remote cache: refusing to restore "${entry.name}" under the ` +
            `symlink "${ancestor}" from the same archive.`,
        );
      }
    }
    if (entry.linkname === undefined && links.has(entry.name)) {
      throw new Error(
        `remote cache: refusing an archive with "${entry.name}" as both a ` +
          `file and a symlink.`,
      );
    }
  }
}

/**
 * The store key for a target's outputs: its name and input `fingerprint`,
 * behind the {@link ARCHIVE_FORMAT} version. The name is sanitised so the key
 * is safe as a filename and a URL path segment.
 */
export function remoteCacheKey(name: string, fingerprint: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${ARCHIVE_FORMAT}-${safe}-${fingerprint}`;
}

/**
 * The archive format in every {@link remoteCacheKey}. Bumped when an archive
 * gains something an older restore refuses — `v2` added symlink entries — so
 * an older Zuke misses and rebuilds instead of fetching what it cannot restore.
 */
const ARCHIVE_FORMAT = "v2";

/** Configuration for a {@link FileSystemCacheStore}. */
export interface FileSystemCacheStoreOptions {
  /**
   * The most a fetched artifact may decompress to, in bytes — see
   * {@link RemoteCacheStore.maxInflatedBytes}. Defaults to 2 GiB.
   */
  maxInflatedBytes?: number;
  /**
   * The current user's id, or `null` where the platform has none (Windows).
   * Defaults to `Deno.uid`; overridable for tests.
   */
  uid?: () => number | null;
}

/**
 * A {@link RemoteCacheStore} backed by a shared or mounted directory.
 *
 * On POSIX an entry is refused (a warned rebuild) unless the current user owns
 * it and neither its group nor others may write it: anyone who can replace an
 * archive chooses files a later target runs. Windows has no such bits, so the
 * check is skipped there.
 */
export class FileSystemCacheStore implements RemoteCacheStore {
  readonly #dir: string;
  readonly #uid: () => number | null;
  /** The most an artifact may decompress to; see {@link RemoteCacheStore.maxInflatedBytes}. */
  readonly maxInflatedBytes?: number;

  /**
   * Build the store over a directory.
   *
   * @param dir The directory archives are read from and written to.
   * @param options The restore bound.
   */
  constructor(dir: string, options: FileSystemCacheStoreOptions = {}) {
    this.#dir = dir;
    this.maxInflatedBytes = options.maxInflatedBytes;
    this.#uid = options.uid ?? Deno.uid;
  }

  #path(key: string): string {
    return `${this.#dir}/${key}.tar.gz`;
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  async get(key: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(key);
    return stream === null
      ? null
      : new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * The archive stored under `key` as a stream, or `null` if there is none.
   * Refused when another user owns it or it is group- or world-writable.
   */
  async getStream(
    key: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> {
    let file: Deno.FsFile;
    try {
      file = await Deno.open(this.#path(key));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
    try {
      // The open handle's stat, so the file checked is the file read.
      const info = await file.stat();
      const uid = this.#uid();
      // No uid means no POSIX permissions (Windows): Deno reports every
      // writable file there as mode 666, so neither check means anything.
      if (uid !== null && info.uid !== null && info.uid !== uid) {
        throw new Error(
          `remote cache: refusing "${key}", which is owned by another user ` +
            `(uid ${info.uid}).`,
        );
      }
      if (uid !== null && info.mode !== null && (info.mode & 0o022) !== 0) {
        throw new Error(
          `remote cache: refusing "${key}", which other users can write ` +
            `(mode ${(info.mode & 0o777).toString(8)}).`,
        );
      }
    } catch (error) {
      file.close();
      throw error;
    }
    return file.readable;
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  put(key: string, artifact: Uint8Array): Promise<void> {
    return this.putStream(key, byteStream(artifact));
  }

  /**
   * Store the archive `artifact` streams under `key`. It is written under a
   * temporary name and renamed into place, so a reader on another machine
   * never sees a half-written archive.
   */
  async putStream(
    key: string,
    artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<void> {
    await Deno.mkdir(this.#dir, { recursive: true });
    const partial = `${this.#path(key)}.${crypto.randomUUID()}.partial`;
    try {
      await Deno.writeFile(partial, artifact);
      // Not group-writable whatever the umask, so getStream accepts it.
      if (Deno.build.os !== "windows") await Deno.chmod(partial, 0o644);
      await Deno.rename(partial, this.#path(key));
    } catch (error) {
      await Deno.remove(partial).catch(() => {}); // already gone is fine
      throw error;
    }
  }
}

/** Configuration for an {@link HttpCacheStore}. */
export interface HttpCacheStoreOptions {
  /**
   * The base URL keys are appended to (any trailing slash is ignored). A query
   * string is kept and the key goes before it, so an Azure Blob container's
   * SAS URL (`https://acct.blob.core.windows.net/container?sv=…`) works as
   * is.
   */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /**
   * Headers sent on every request: basic auth for a Gradle-protocol or WebDAV
   * cache, GitLab's `JOB-TOKEN`, or whatever else a server wants. The store's
   * own headers (the bearer token, the content type) win on a clash.
   */
  headers?: Record<string, string>;
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
  /**
   * The most a fetched artifact may decompress to, in bytes — see
   * {@link RemoteCacheStore.maxInflatedBytes}. Defaults to 2 GiB.
   */
  maxInflatedBytes?: number;
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
 * decompresses to. Within the declared outputs, though, a store writer
 * chooses what is restored unless `ZUKE_REMOTE_CACHE_SIGNING_KEY` is set
 * ({@link "./cache.ts".OpenCacheOptions.signingKey}).
 */
export class HttpCacheStore implements RemoteCacheStore {
  readonly #base: string;
  readonly #query: string;
  readonly #token?: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;
  readonly #maxArtifactBytes: number;
  /** The most an artifact may decompress to; see {@link RemoteCacheStore.maxInflatedBytes}. */
  readonly maxInflatedBytes?: number;

  /** Build the store from its URL, optional token, size caps, and `fetch` seam. */
  constructor(options: HttpCacheStoreOptions) {
    this.maxInflatedBytes = options.maxInflatedBytes;
    const at = options.url.indexOf("?");
    const path = at === -1 ? options.url : options.url.slice(0, at);
    this.#base = path.replace(/\/+$/, "");
    this.#query = at === -1 ? "" : options.url.slice(at);
    this.#token = options.token;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? fetch;
    this.#maxArtifactBytes = options.maxArtifactBytes ??
      DEFAULT_MAX_ARTIFACT_BYTES;
  }

  #url(key: string): string {
    return `${this.#base}/${encodeURIComponent(key)}${this.#query}`;
  }

  #requestHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...this.#headers, ...extra };
    if (this.#token !== undefined && this.#token !== "") {
      headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  async get(key: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(key);
    return stream === null
      ? null
      : new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * The archive stored under `key` as a stream, or `null` if there is none.
   * It is bounded as it arrives rather than measured after: a store that
   * answers with an endless body would otherwise exhaust memory or disk
   * before there was anything to reject.
   */
  async getStream(
    key: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> {
    const url = this.#url(key);
    const response = await this.#fetch(url, {
      headers: this.#requestHeaders(),
    });
    return await artifactBody(
      response,
      url,
      this.#maxArtifactBytes,
      () =>
        new Error(
          `remote cache: refusing an artifact larger than ` +
            `${this.#maxArtifactBytes} bytes from ${redactUrl(url)}.`,
        ),
    );
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  async put(key: string, artifact: Uint8Array): Promise<void> {
    const url = this.#url(key);
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: this.#requestHeaders({
        "content-type": "application/octet-stream",
        // Azure Blob Storage refuses a PUT without a blob type; every other
        // server ignores the header. Stated here so a SAS URL needs nothing
        // else.
        "x-ms-blob-type": "BlockBlob",
      }),
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
 * `ZUKE_REMOTE_CACHE_S3_URL` selects an {@link "./s3_cache.ts".S3CacheStore}
 * signed with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (and
 * `AWS_SESSION_TOKEN`) in `AWS_REGION` or `AWS_DEFAULT_REGION`; otherwise
 * `ZUKE_REMOTE_CACHE_DIR` selects a {@link FileSystemCacheStore}; otherwise,
 * on a GitHub Actions job that exposes its `ACTIONS_RUNTIME_TOKEN` and
 * `ACTIONS_RESULTS_URL` (the `actions-cache` input of the `zuke-build/zuke`
 * action), a {@link "./github_actions_cache.ts".GitHubActionsCacheStore}.
 * Whichever is chosen takes `ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES`, when set,
 * as its {@link RemoteCacheStore.maxInflatedBytes}.
 */
export function envCacheStore(
  readEnv: (name: string) => string | undefined,
): RemoteCacheStore | undefined {
  // Read only once a store is chosen, so it cannot fail a build that has none.
  const limit = () => envInflatedLimit(readEnv);
  const url = readEnv("ZUKE_REMOTE_CACHE_URL");
  if (url !== undefined && url !== "") {
    assertSecureBackendUrl(url, "ZUKE_REMOTE_CACHE_URL", readEnv);
    return new HttpCacheStore({
      url,
      token: readEnv("ZUKE_REMOTE_CACHE_TOKEN"),
      maxInflatedBytes: limit(),
    });
  }
  const s3 = readEnv("ZUKE_REMOTE_CACHE_S3_URL");
  if (s3 !== undefined && s3 !== "") {
    assertSecureBackendUrl(s3, "ZUKE_REMOTE_CACHE_S3_URL", readEnv);
    return new S3CacheStore({
      url: s3,
      ...s3Signing(readEnv),
      maxInflatedBytes: limit(),
    });
  }
  const dir = readEnv("ZUKE_REMOTE_CACHE_DIR");
  if (dir !== undefined && dir !== "") {
    return new FileSystemCacheStore(dir, { maxInflatedBytes: limit() });
  }
  const token = readEnv("ACTIONS_RUNTIME_TOKEN");
  const results = readEnv("ACTIONS_RESULTS_URL");
  if (
    token !== undefined && token !== "" && results !== undefined &&
    results !== ""
  ) {
    assertSecureBackendUrl(results, "ACTIONS_RESULTS_URL", readEnv);
    return new GitHubActionsCacheStore({
      url: results,
      token,
      maxInflatedBytes: limit(),
    });
  }
  return undefined;
}

/**
 * `ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES` as a byte count, or `undefined` when
 * unset. Anything but a positive whole number is an error naming the variable,
 * not a silently ignored limit.
 */
function envInflatedLimit(
  readEnv: (name: string) => string | undefined,
): number | undefined {
  const name = "ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES";
  const raw = readEnv(name);
  if (raw === undefined || raw === "") return undefined;
  const bytes = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(bytes)) {
    throw new Error(
      `remote cache: ${name} must be a positive whole number of bytes, ` +
        `got "${raw}".`,
    );
  }
  return bytes;
}

/**
 * The signing region and credentials for `ZUKE_REMOTE_CACHE_S3_URL`, from the
 * variables the AWS SDKs read. Misconfiguration is an error naming the
 * variable rather than an unsigned request the bucket would refuse.
 */
function s3Signing(
  readEnv: (name: string) => string | undefined,
): { region: string; credentials: AwsCredentials } {
  const need = (...names: string[]): string => {
    for (const name of names) {
      const value = readEnv(name);
      if (value !== undefined && value !== "") return value;
    }
    throw new Error(
      `remote cache: ZUKE_REMOTE_CACHE_S3_URL needs ${names.join(" or ")}.`,
    );
  };
  const sessionToken = readEnv("AWS_SESSION_TOKEN");
  return {
    region: need("AWS_REGION", "AWS_DEFAULT_REGION"),
    credentials: {
      accessKeyId: need("AWS_ACCESS_KEY_ID"),
      secretAccessKey: need("AWS_SECRET_ACCESS_KEY"),
      ...(sessionToken === undefined || sessionToken === ""
        ? {}
        : { sessionToken }),
    },
  };
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
