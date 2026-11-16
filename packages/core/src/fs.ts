// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Core's file access, on `node:fs`, which every runtime Zuke runs on
 * implements. Everything here is module-internal: builds use `FileTasks`.
 *
 * Two things are settled in this one place so no caller has to know them.
 *
 * - **Shapes.** A {@link FileInfo} has properties, not methods, and file
 *   contents are a plain `Uint8Array`, so nothing above depends on a runtime's
 *   own types.
 * - **Error classes on Deno.** Under Deno, `node:fs` throws a plain `Error`
 *   with a `code`, not the `Deno.errors` class the same failure has always
 *   had. Errors from core's tasks reach users' builds, where they are matched
 *   by class, so on Deno a failure is rethrown as that class, carrying the
 *   code and the original error. On any other runtime it is thrown as it is.
 *
 * @module
 */

import { lstatSync as nodeLstatSync, type Stats } from "node:fs";
import {
  copyFile as nodeCopyFile,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  readlink as nodeReadlink,
  rename as nodeRename,
  rm as nodeRm,
  rmdir as nodeRmdir,
  stat as nodeStat,
  symlink as nodeSymlink,
  unlink as nodeUnlink,
} from "node:fs/promises";
import process from "node:process";

/**
 * Whether this is Windows, which has no permission bits to set, and where
 * Deno reports a few failures differently than it does elsewhere.
 */
const WINDOWS = process.platform === "win32";

/** What is at a path. */
export interface FileInfo {
  /** Whether it is a regular file. */
  isFile: boolean;
  /** Whether it is a directory. */
  isDirectory: boolean;
  /** Whether it is a symbolic link (only ever true from an `lstat`). */
  isSymlink: boolean;
  /** Its size in bytes. */
  size: number;
  /** Its permission and type bits, as the platform reports them. */
  mode: number;
}

/** One entry of a directory. */
export interface DirEntry {
  /** Its name, without the directory's path. */
  name: string;
  /** Whether it is a directory; a link to one is not. */
  isDirectory: boolean;
}

/**
 * The `Deno.errors` class each file-system code has always surfaced as, and
 * `null` for a code with none, or on a runtime that is not Deno. Read when an
 * error is made, never at load, since only Deno has them.
 */
function denoErrorFor(code: string): (new (message: string) => Error) | null {
  if (typeof Deno === "undefined") return null;
  switch (code) {
    case "ENOENT":
      return Deno.errors.NotFound;
    case "EEXIST":
      return Deno.errors.AlreadyExists;
    case "EACCES":
    case "EPERM":
      return Deno.errors.PermissionDenied;
    case "ENOTDIR":
      return Deno.errors.NotADirectory;
    case "EISDIR":
      // On Windows Deno throws a plain error for this one.
      return WINDOWS ? null : Deno.errors.IsADirectory;
    case "ELOOP":
      return Deno.errors.FilesystemLoop;
    case "EINVAL":
      // Deno has no class of its own for an invalid argument, and on Windows
      // throws a plain error for it.
      return WINDOWS ? null : TypeError;
    default:
      return null;
  }
}

/**
 * Codes an operation reports under another name on Deno, keyed by the code
 * `node:fs` gives. Each entry is a difference the parity tests found by
 * running both on the platform it names.
 */
type Recoded = Readonly<Record<string, string>>;

/**
 * Deno on Windows reports a directory that cannot be made because a file is
 * in the way as already existing, where `node:fs` says it is not a directory.
 */
const MKDIR_ON_WINDOWS: Recoded = { ENOTDIR: "EEXIST" };

/**
 * `error` as a caller on this runtime has always seen it: on Deno, the
 * `Deno.errors` class for its code, with the code and the original kept; any
 * other error, and every error on another runtime, unchanged. `recoded`
 * renames a code first, for an operation Deno reports differently.
 */
function surfaced(error: unknown, recoded: Recoded = {}): unknown {
  if (
    !(error instanceof Error) || !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return error;
  }
  const code = recoded[error.code] ?? error.code;
  const Kind = denoErrorFor(code);
  if (Kind === null) return error;
  return Object.assign(new Kind(error.message), { code, cause: error });
}

/**
 * The error for a path that is in the way, for a refusal core decides itself:
 * the class and code the file system's own refusal has.
 */
export function alreadyExists(message: string): Error {
  const Kind = denoErrorFor("EEXIST") ?? Error;
  return Object.assign(new Kind(message), { code: "EEXIST" });
}

/**
 * Run a file operation, surfacing its failure as {@link surfaced} says.
 * `recoded` is passed for an operation whose codes Deno renames.
 */
async function io<T>(
  operation: () => Promise<T>,
  recoded?: Recoded,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw surfaced(error, recoded);
  }
}

/** {@link io} for an operation that does not wait. */
function ioSync<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw surfaced(error);
  }
}

/** A `node:fs` `Stats` as a {@link FileInfo}. */
function fileInfo(stats: Stats): FileInfo {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    mode: stats.mode,
  };
}

/** A file's bytes. */
export function readFile(path: string): Promise<Uint8Array> {
  return io(async () => {
    const buffer = await nodeReadFile(path);
    // The same bytes as a plain array: callers compare and hash them, and a
    // Buffer is a different class.
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  });
}

/** A file's contents as UTF-8 text. */
export function readTextFile(path: string): Promise<string> {
  return io(() => nodeReadFile(path, "utf8"));
}

/** What `path` resolves to, following a final link. */
export function stat(path: string): Promise<FileInfo> {
  return io(async () => fileInfo(await nodeStat(path)));
}

/** What is at `path` itself: a final link is described, not followed. */
export function lstat(path: string): Promise<FileInfo> {
  return io(async () => fileInfo(await nodeLstat(path)));
}

/** {@link lstat}, without waiting. */
export function lstatSync(path: string): FileInfo {
  return ioSync(() => fileInfo(nodeLstatSync(path)));
}

/** Create the directory `path` and any parent it is missing. */
export function mkdirRecursive(path: string): Promise<void> {
  return io(async () => {
    await nodeMkdir(path, { recursive: true });
  }, WINDOWS ? MKDIR_ON_WINDOWS : undefined);
}

/** Create the one directory `path`, whose parent must exist. */
export function mkdir(path: string): Promise<void> {
  return io(() => nodeMkdir(path));
}

/** The entries of the directory `path`, in no particular order. */
export function readDir(path: string): Promise<DirEntry[]> {
  return io(async () => {
    const entries = await nodeReaddir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  });
}

/**
 * Remove `path`: a file, a link, or a directory, which must be empty unless
 * `recursive`. A link is removed itself, never what it points at.
 */
export function remove(path: string, recursive: boolean): Promise<void> {
  return io(async () => {
    if (recursive) return await nodeRm(path, { recursive: true });
    // node:fs has one call for a file and another for a directory.
    const stats = await nodeLstat(path);
    await (stats.isDirectory() ? nodeRmdir(path) : nodeUnlink(path));
  });
}

/** Copy the file `source` to `destination`, replacing what is there. */
export function copyFile(source: string, destination: string): Promise<void> {
  return io(() => nodeCopyFile(source, destination));
}

/** Rename `source` to `destination`, replacing a file or link there. */
export function rename(source: string, destination: string): Promise<void> {
  return io(() => nodeRename(source, destination));
}

/**
 * Create a symbolic link at `path` holding `target` as given. `type` says
 * what the target is, which only Windows needs.
 */
export function symlink(
  target: string,
  path: string,
  type?: "file" | "dir",
): Promise<void> {
  return io(() => nodeSymlink(target, path, type));
}

/** The target stored in the symbolic link at `path`. */
export function readLink(path: string): Promise<string> {
  return io(() => nodeReadlink(path));
}

/**
 * Write `data` to `path`, replacing what is there. `mode` sets the file's
 * permission bits, on a file that already exists too; Windows has none and
 * ignores it.
 */
export function writeFile(
  path: string,
  data: Uint8Array | string,
  mode?: number,
): Promise<void> {
  return io(async () => {
    const file = await nodeOpen(path, "w", mode);
    try {
      // Opening applies the mode only to a file it creates, so it is set
      // again on the open file, before anything is written.
      if (mode !== undefined && !WINDOWS) await file.chmod(mode);
      await file.writeFile(data);
    } finally {
      await file.close();
    }
  });
}
