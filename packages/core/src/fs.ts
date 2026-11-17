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

import {
  lstatSync as nodeLstatSync,
  realpathSync as nodeRealpathSync,
  type Stats,
  statSync as nodeStatSync,
  writeFileSync as nodeWriteFileSync,
} from "node:fs";
import {
  chmod as nodeChmod,
  copyFile as nodeCopyFile,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  open as nodeOpen,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  readlink as nodeReadlink,
  realpath as nodeRealpath,
  rename as nodeRename,
  rm as nodeRm,
  rmdir as nodeRmdir,
  stat as nodeStat,
  symlink as nodeSymlink,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** A file open for reading: who owns it, and its bytes, from the same handle. */
export interface OpenFile {
  /** The id of the user who owns the file; `0` on Windows, which has none. */
  uid: number;
  /** Its permission and type bits, as the platform reports them. */
  mode: number;
  /**
   * The file's bytes from the start. The file is closed when the stream ends,
   * fails or is cancelled.
   */
  readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  /** Close the file without reading it. */
  close(): Promise<void>;
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

/** {@link stat}, without waiting. */
export function statSync(path: string): FileInfo {
  return ioSync(() => fileInfo(nodeStatSync(path)));
}

/** Whether `path` is an existing file, following a final link. */
export function isFileSync(path: string): boolean {
  try {
    return nodeStatSync(path).isFile();
  } catch {
    return false;
  }
}

/** {@link realPath}, without waiting. */
export function realPathSync(path: string): string {
  return ioSync(() => nodeRealpathSync(path));
}

/** Add `text` to the end of the file `path`, creating it, without waiting. */
export function appendTextSync(path: string, text: string): void {
  // Not appendFileSync: under Deno it resets the file's mode to 666 on every
  // call, opening a private file to everyone.
  ioSync(() => nodeWriteFileSync(path, text, { flag: "a" }));
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

/**
 * The system's temporary directory. Finding it reads the environment, which
 * a Deno run may deny; core works without that permission, so a denial falls
 * back to where POSIX keeps temporary files.
 */
function tempRoot(): string {
  try {
    return tmpdir();
  } catch (error) {
    // shortcut: Windows has no fixed place to fall back to, so a denial
    // there is reported; give it one if a build needs that.
    if (WINDOWS) throw error;
    return "/tmp";
  }
}

/** How many bytes of a file one read of {@link openFile}'s stream asks for. */
const READ_CHUNK = 64 * 1024;

/**
 * Open `path` for reading. The owner and mode are the open file's own, so
 * what a caller checks is what it then reads, whatever happens to the path.
 */
export function openFile(path: string): Promise<OpenFile> {
  return io(async () => {
    const file = await nodeOpen(path, "r");
    const close = () => file.close();
    try {
      const stats = await file.stat();
      const readable = new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          try {
            const chunk = new Uint8Array(READ_CHUNK);
            const { bytesRead } = await file.read(chunk, 0, READ_CHUNK);
            if (bytesRead > 0) {
              return controller.enqueue(chunk.subarray(0, bytesRead));
            }
            await close();
            controller.close();
          } catch (error) {
            await close().catch(() => {});
            throw surfaced(error);
          }
        },
        cancel: close,
      });
      return { uid: stats.uid, mode: stats.mode, readable, close };
    } catch (error) {
      await close().catch(() => {});
      throw error;
    }
  });
}

/**
 * Write everything `data` streams to `path`, replacing what is there. A
 * stream that fails leaves the file with what had arrived.
 */
export function writeStream(
  path: string,
  data: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<void> {
  return io(async () => {
    const file = await nodeOpen(path, "w");
    try {
      for await (const chunk of data) await file.writeFile(chunk);
    } finally {
      await file.close();
    }
  });
}

/** The id of the user this process runs as, or `null` on Windows, which has none. */
export function userId(): number | null {
  return process.getuid?.() ?? null;
}

/** Create a directory of its own under the system's temporary one. */
export function makeTempDir(): Promise<string> {
  return io(() => nodeMkdtemp(`${tempRoot()}/zuke-`));
}

/** Set the permission bits of `path`. Not for Windows, which has none. */
export function chmod(path: string, mode: number): Promise<void> {
  return io(() => nodeChmod(path, mode));
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

/** `path` with every link in it resolved, as an absolute path. */
export function realPath(path: string): Promise<string> {
  return io(() => nodeRealpath(path));
}

/**
 * Create the empty file `path`, failing if anything is already there. One
 * step, so of several callers racing for a path exactly one succeeds.
 */
export function createNew(path: string): Promise<void> {
  return io(async () => {
    const file = await nodeOpen(path, "wx");
    await file.close();
  });
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
