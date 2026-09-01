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
 * import { FileTasks } from "jsr:@zuke/core";
 *
 * await FileTasks.cleanDirectory("dist");        // empty it if it exists
 * await FileTasks.createDirectory("dist/assets"); // mkdir -p
 * await FileTasks.copy("static", "dist/static");  // recursive
 * ```
 *
 * @module
 */

import { defaultReadEnv } from "./internal.ts";
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

/** Whether a filesystem entry exists; a `NotFound` maps to `false`. */
async function entryExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Recursively copy a file or directory tree from `src` to `dest`. */
async function copyEntry(
  src: string,
  dest: string,
  overwrite: boolean,
): Promise<void> {
  const info = await Deno.stat(src);
  if (info.isDirectory) {
    await Deno.mkdir(dest, { recursive: true });
    for await (const entry of Deno.readDir(src)) {
      await copyEntry(
        `${src}/${entry.name}`,
        `${dest}/${entry.name}`,
        overwrite,
      );
    }
    return;
  }
  if (!overwrite && await entryExists(dest)) {
    throw new Deno.errors.AlreadyExists(
      `FileTasks.copy: destination "${dest}" exists and overwrite is false.`,
    );
  }
  await Deno.copyFile(src, dest);
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
  writeText(path: PathLike, content: string): Promise<void>;

  /** Read and parse the JSON file at `path`. */
  readJson<T = unknown>(path: PathLike): Promise<T>;
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
    await Deno.mkdir(String(path), { recursive: options.recursive ?? true });
  },

  async cleanDirectory(path: PathLike): Promise<void> {
    const dir = String(path);
    let entries: AsyncIterable<Deno.DirEntry>;
    try {
      entries = Deno.readDir(dir);
      for await (const entry of entries) {
        await Deno.remove(`${dir}/${entry.name}`, { recursive: true });
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return; // nothing to clean
      throw error;
    }
  },

  async remove(path: PathLike, options: RemoveOptions = {}): Promise<boolean> {
    try {
      await Deno.remove(String(path), {
        recursive: options.recursive ?? false,
      });
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
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
    return Deno.rename(String(source), String(destination));
  },

  async symlink(
    target: PathLike,
    path: PathLike,
    options: SymlinkOptions = {},
  ): Promise<void> {
    const linkPath = String(path);
    // Deno.symlink takes `{ type }`, and rejects an unknown key, so the
    // force flag is this layer's own and never reaches it.
    const denoOptions = options.type === undefined
      ? undefined
      : { type: options.type };
    try {
      await Deno.symlink(String(target), linkPath, denoOptions);
      return;
    } catch (error) {
      // Attempt first, then replace: a caller without `force` gets Deno's own
      // AlreadyExists untouched, and nothing on disk is unlinked until the
      // path is known to be occupied.
      if (!(error instanceof Deno.errors.AlreadyExists) || !options.force) {
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
    await Deno.symlink(String(target), tmp, denoOptions);
    try {
      await Deno.rename(tmp, linkPath);
    } catch (error) {
      // The link exists at a name nobody asked for; take it back out before
      // reporting why it could not be published.
      await Deno.remove(tmp).catch(() => {});
      throw error;
    }
  },

  readLink(path: PathLike): Promise<string> {
    return Deno.readLink(String(path));
  },

  readText(path: PathLike): Promise<string> {
    return Deno.readTextFile(String(path));
  },

  async writeText(path: PathLike, content: string): Promise<void> {
    await Deno.writeTextFile(String(path), content);
  },

  async readJson<T = unknown>(path: PathLike): Promise<T> {
    return JSON.parse(await Deno.readTextFile(String(path)));
  },
};
