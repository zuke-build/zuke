// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `FileTasks` — filesystem operations for build scripts, grouped as a namespaced
 * task object in the same shape as Zuke's tool wrappers (`DenoTasks`, etc.). The
 * operations a `clean`/`package` target reaches for — create, clean, remove,
 * copy, move a path, and read/write its contents — with the missing-target
 * tolerance that keeps them idempotent.
 *
 * Unlike the CLI wrappers, these run no subprocess, so the methods take direct
 * arguments rather than a settings-lambda.
 *
 * ```ts
 * import { FileTasks } from "@zuke/core";
 *
 * await FileTasks.cleanDirectory("dist");        // empty it if it exists
 * await FileTasks.createDirectory("dist/assets"); // mkdir -p
 * await FileTasks.copy("static", "dist/static");  // recursive
 * ```
 *
 * @module
 */

import process from "node:process";
import {
  alreadyExists,
  chmod,
  copyFile,
  type FileInfo,
  lstat,
  makeTempDir,
  mkdir,
  mkdirRecursive,
  readDir,
  readFile,
  readLink,
  readTextFile,
  realPath,
  remove,
  rename,
  stat,
  statSync,
  symlink,
  writeFile,
} from "./fs.ts";
import {
  defaultReadEnv,
  isAlreadyExists,
  isNotFound,
  lstatOrNull,
} from "./internal.ts";
import type { PathLike } from "./path.ts";

/** Options for {@link FileTasksApi.createDirectory}. */
export interface CreateDirectoryOptions {
  /** Create parent directories as needed (default `true`). */
  recursive?: boolean;
}

/** Options for {@link FileTasksApi.remove}. */
export interface RemoveOptions {
  /** Remove a directory and its contents recursively, like `rm -r`. */
  recursive?: boolean;
}

/** Options for {@link FileTasksApi.copy}. */
export interface CopyOptions {
  /** Overwrite an existing destination file (default `true`). */
  overwrite?: boolean;
}

/** Options for {@link FileTasksApi.symlink}. */
export interface SymlinkOptions {
  /**
   * Replace an existing entry at the link path, the way `ln -sfn` does
   * (default `false`, which throws an `AlreadyExists` as `Deno.symlink` does).
   *
   * The replacement is atomic: the new link is created under a sibling temp
   * name and renamed over the path, so a concurrent reader sees either the old
   * entry or the new link and never a missing path. A **directory** at the
   * path is never replaced — the rename refuses it, empty or not — so forcing
   * a link cannot cost a caller a directory.
   */
  force?: boolean;
  /**
   * What the link points at: `"file"` or `"dir"`. Windows needs the
   * distinction and ignores nothing else; POSIX ignores the option entirely.
   * Pass `"dir"` when linking a directory, or the link is unusable on Windows.
   */
  type?: "file" | "dir";
}

/** Options for {@link FileTasksApi.writeText} and {@link FileTasksApi.writeBytes}. */
export interface WriteOptions {
  /**
   * The file's permission bits, applied to a file that already exists too.
   * Windows has none and ignores it.
   */
  mode?: number;
  /**
   * Fail with an `AlreadyExists` when anything is at the path, instead of
   * replacing it. The check and the create are one step, so of several
   * writers racing for a path exactly one succeeds.
   */
  createNew?: boolean;
}

/** Options for {@link FileTasksApi.makeTempDirectory}. */
export interface TempDirectoryOptions {
  /** How the directory's name starts (default `"zuke-"`). */
  prefix?: string;
}

/** What is at a path, as {@link FileTasksApi.stat} and its kin report it. */
export interface PathInfo {
  /** Whether it is a regular file. */
  isFile: boolean;
  /** Whether it is a directory. */
  isDirectory: boolean;
  /** Whether it is a symbolic link; only ever true from `lstat`. */
  isSymlink: boolean;
  /** Its size in bytes. */
  size: number;
  /**
   * Its permission and type bits, or `null` on Windows, whose files have no
   * POSIX permissions to report.
   */
  mode: number | null;
  /** The id of the user who owns it, or `null` on Windows, which has none. */
  uid: number | null;
}

/** One entry of a directory, as {@link FileTasksApi.readDirectory} lists it. */
export interface DirectoryEntry {
  /** Its name, without the directory's path. */
  name: string;
  /** Whether it is a regular file; a link to one is not. */
  isFile: boolean;
  /** Whether it is a directory; a link to one is not. */
  isDirectory: boolean;
}

/** Core's file information as the public {@link PathInfo}. */
function pathInfo(info: FileInfo): PathInfo {
  return {
    ...info,
    mode: process.platform === "win32" ? null : info.mode,
  };
}

/** Whether a filesystem entry exists; a `NotFound` maps to `false`. */
async function entryExists(path: string): Promise<boolean> {
  return await lstatOrNull(path) !== null;
}

/** Recursively copy a file or directory tree from `src` to `dest`. */
async function copyEntry(
  src: string,
  dest: string,
  overwrite: boolean,
): Promise<void> {
  const info = await stat(src);
  if (info.isDirectory) {
    await mkdirRecursive(dest);
    for (const entry of await readDir(src)) {
      await copyEntry(
        `${src}/${entry.name}`,
        `${dest}/${entry.name}`,
        overwrite,
      );
    }
    return;
  }
  if (!overwrite && await entryExists(dest)) {
    throw alreadyExists(
      `FileTasks.copy: destination "${dest}" exists and overwrite is false.`,
    );
  }
  await copyFile(src, dest);
}

/** The shape of {@link FileTasks}. */
export interface FileTasksApi {
  /** Whether `path` exists. */
  exists(path: PathLike): Promise<boolean>;

  /**
   * The current user's home directory, read from `$HOME` (falling back to
   * `$USERPROFILE` on Windows). Throws a clear error when neither is set or
   * environment access is unavailable, so callers get a path or a useful
   * failure — never an `undefined` to thread through.
   */
  homeDirectory(): string;

  /**
   * Create the directory at `path`. Creates parents by default
   * ({@link CreateDirectoryOptions.recursive}); a recursive create is a no-op
   * when the directory already exists.
   */
  createDirectory(
    path: PathLike,
    options?: CreateDirectoryOptions,
  ): Promise<void>;

  /**
   * Remove everything inside the directory at `path`, leaving an empty
   * directory. A no-op if `path` does not exist (it is *not* created).
   */
  cleanDirectory(path: PathLike): Promise<void>;

  /**
   * Remove `path`, tolerating a missing target the way `rm -f` does: a
   * `NotFound` resolves to `false` instead of throwing. Any other error (e.g. a
   * non-empty directory removed without {@link RemoveOptions.recursive}) is
   * rethrown.
   *
   * @returns `true` if something was removed, `false` if `path` did not exist.
   */
  remove(path: PathLike, options?: RemoveOptions): Promise<boolean>;

  /**
   * Copy a file or directory tree from `source` to `destination` (directories
   * are copied recursively).
   */
  copy(
    source: PathLike,
    destination: PathLike,
    options?: CopyOptions,
  ): Promise<void>;

  /** Move (rename) `source` to `destination`. */
  move(source: PathLike, destination: PathLike): Promise<void>;

  /**
   * Create a symbolic link at `path` pointing to `target`.
   *
   * `target` is stored in the link verbatim, so a relative one resolves
   * against the link's own directory — which is what makes a link between two
   * sibling checkouts survive both being moved together.
   *
   * With {@link SymlinkOptions.force} an entry already at `path` is replaced
   * atomically, which is the `ln -sfn` case a re-run of an idempotent target
   * needs; without it an existing entry is an `AlreadyExists` error. A
   * directory at `path` is never replaced.
   */
  symlink(
    target: PathLike,
    path: PathLike,
    options?: SymlinkOptions,
  ): Promise<void>;

  /**
   * The target of the symbolic link at `path`, exactly as stored in the link —
   * relative if it was created relative, and not checked for existence.
   *
   * Throws if `path` is not a symbolic link, which is the same answer
   * `Deno.readLink` gives.
   */
  readLink(path: PathLike): Promise<string>;

  /** Read the UTF-8 text content of the file at `path`. */
  readText(path: PathLike): Promise<string>;

  /** Write `content` to the file at `path`, creating or truncating it. */
  writeText(
    path: PathLike,
    content: string,
    options?: WriteOptions,
  ): Promise<void>;

  /** Read and parse the JSON file at `path`. */
  readJson<T = unknown>(path: PathLike): Promise<T>;

  /** Read the file at `path` as bytes. */
  readBytes(path: PathLike): Promise<Uint8Array>;

  /** Write `data` to the file at `path`, replacing it unless `createNew`. */
  writeBytes(
    path: PathLike,
    data: Uint8Array,
    options?: WriteOptions,
  ): Promise<void>;

  /** What `path` resolves to, following a final link. */
  stat(path: PathLike): Promise<PathInfo>;

  /** {@link FileTasksApi.stat}, without waiting. */
  statSync(path: PathLike): PathInfo;

  /** What is at `path` itself: a final link is described, not followed. */
  lstat(path: PathLike): Promise<PathInfo>;

  /** `path` with every link in it resolved, as an absolute path. */
  realPath(path: PathLike): Promise<string>;

  /** The entries of the directory at `path`, in no particular order. */
  readDirectory(path: PathLike): Promise<DirectoryEntry[]>;

  /**
   * Create a directory of its own under the system's temporary directory and
   * return its path. Removing it is the caller's job.
   */
  makeTempDirectory(options?: TempDirectoryOptions): Promise<string>;

  /** Set the permission bits of `path`. Not for Windows, which has none. */
  chmod(path: PathLike, mode: number): Promise<void>;

  /**
   * Whether `error` means the path was not there, on any runtime: the check
   * a caller makes before treating a missing file as empty.
   */
  isNotFound(error: unknown): error is Error;
}

/** Filesystem task functions for build scripts. */
export const FileTasks: FileTasksApi = {
  exists(path: PathLike): Promise<boolean> {
    return entryExists(String(path));
  },

  homeDirectory(): string {
    const home = defaultReadEnv("HOME") ?? defaultReadEnv("USERPROFILE");
    if (home === undefined || home === "") {
      throw new Error(
        "Cannot determine the home directory: neither HOME nor USERPROFILE " +
          "is set.",
      );
    }
    return home;
  },

  async createDirectory(
    path: PathLike,
    options: CreateDirectoryOptions = {},
  ): Promise<void> {
    await (options.recursive ?? true ? mkdirRecursive : mkdir)(String(path));
  },

  async cleanDirectory(path: PathLike): Promise<void> {
    const dir = String(path);
    try {
      for (const entry of await readDir(dir)) {
        await remove(`${dir}/${entry.name}`, true);
      }
    } catch (error) {
      if (isNotFound(error)) return; // nothing to clean
      throw error;
    }
  },

  async remove(path: PathLike, options: RemoveOptions = {}): Promise<boolean> {
    try {
      await remove(String(path), options.recursive ?? false);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  },

  copy(
    source: PathLike,
    destination: PathLike,
    options: CopyOptions = {},
  ): Promise<void> {
    return copyEntry(
      String(source),
      String(destination),
      options.overwrite ?? true,
    );
  },

  move(source: PathLike, destination: PathLike): Promise<void> {
    return rename(String(source), String(destination));
  },

  async symlink(
    target: PathLike,
    path: PathLike,
    options: SymlinkOptions = {},
  ): Promise<void> {
    const linkPath = String(path);
    try {
      await symlink(String(target), linkPath, options.type);
      return;
    } catch (error) {
      // Attempt first, then replace: a caller without `force` gets the file system's own
      // AlreadyExists untouched, and nothing on disk is unlinked until the
      // path is known to be occupied.
      if (!isAlreadyExists(error) || !options.force) {
        throw error;
      }
    }
    // Occupied, and the caller asked to force it. Link at a sibling temp name
    // and rename that over the path, rather than unlinking the path first.
    //
    // The rename is atomic, which buys two things an unlink-then-link cannot.
    // A concurrent reader sees either the old entry or the new link, never a
    // missing path. And nothing is ever removed *by name*: an entry that
    // appeared between the failed attempt and this line is replaced, not
    // deleted out from under whoever created it — including a directory, which
    // rename refuses outright, so a link request cannot cost a caller a
    // directory whether it was empty or not.
    const tmp = `${linkPath}.zuke-symlink-${crypto.randomUUID()}`;
    await symlink(String(target), tmp, options.type);
    try {
      await rename(tmp, linkPath);
    } catch (error) {
      // The link exists at a name nobody asked for; take it back out before
      // reporting why it could not be published.
      await remove(tmp, false).catch(() => {});
      throw error;
    }
  },

  readLink(path: PathLike): Promise<string> {
    return readLink(String(path));
  },

  readText(path: PathLike): Promise<string> {
    return readTextFile(String(path));
  },

  async writeText(
    path: PathLike,
    content: string,
    options: WriteOptions = {},
  ): Promise<void> {
    await writeFile(String(path), content, options.mode, options.createNew);
  },

  async readJson<T = unknown>(path: PathLike): Promise<T> {
    return JSON.parse(await readTextFile(String(path)));
  },

  readBytes(path: PathLike): Promise<Uint8Array> {
    return readFile(String(path));
  },

  async writeBytes(
    path: PathLike,
    data: Uint8Array,
    options: WriteOptions = {},
  ): Promise<void> {
    await writeFile(String(path), data, options.mode, options.createNew);
  },

  async stat(path: PathLike): Promise<PathInfo> {
    return pathInfo(await stat(String(path)));
  },

  statSync(path: PathLike): PathInfo {
    return pathInfo(statSync(String(path)));
  },

  async lstat(path: PathLike): Promise<PathInfo> {
    return pathInfo(await lstat(String(path)));
  },

  realPath(path: PathLike): Promise<string> {
    return realPath(String(path));
  },

  readDirectory(path: PathLike): Promise<DirectoryEntry[]> {
    return readDir(String(path));
  },

  makeTempDirectory(options: TempDirectoryOptions = {}): Promise<string> {
    return makeTempDir(options.prefix);
  },

  chmod(path: PathLike, mode: number): Promise<void> {
    return chmod(String(path), mode);
  },

  isNotFound(error: unknown): error is Error {
    return isNotFound(error);
  },
};
