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
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  stat as nodeStat,
} from "node:fs/promises";
import process from "node:process";

/** Whether this is Windows, which has no permission bits to set. */
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

/**
 * The `Deno.errors` class each file-system code has always surfaced as. Read
 * when an error is translated, never at load, since only Deno has them.
 */
function denoErrorFor(code: string): (new (message: string) => Error) | null {
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
      return Deno.errors.IsADirectory;
    case "ELOOP":
      return Deno.errors.FilesystemLoop;
    default:
      return null;
  }
}

/**
 * `error` as a caller on this runtime has always seen it: on Deno, the
 * `Deno.errors` class for its code, with the code and the original kept; any
 * other error, and every error on another runtime, unchanged.
 */
function surfaced(error: unknown): unknown {
  if (
    typeof Deno === "undefined" || !(error instanceof Error) ||
    !("code" in error) || typeof error.code !== "string"
  ) {
    return error;
  }
  const Kind = denoErrorFor(error.code);
  if (Kind === null) return error;
  return Object.assign(new Kind(error.message), {
    code: error.code,
    cause: error,
  });
}

/** Run a file operation, surfacing its failure as {@link surfaced} says. */
async function io<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw surfaced(error);
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
  });
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
