// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Small utilities shared across core modules. This module is **internal**: it is
 * not re-exported from `mod.ts` (or any entrypoint), so nothing here is public
 * API. It exists to consolidate helpers that were previously copy-pasted per
 * module (env reads, error-message extraction, a delay, a SHA-256 hex digest,
 * the `NotFound → null` filesystem readers, the mkdir-parent writers, and a
 * timeout wrapper) so the copies can't drift out of sync.
 *
 * @module
 */

/**
 * Read an environment variable, tolerating a denied `--allow-env` permission by
 * returning `undefined` rather than throwing. The default env reader every
 * command uses when the caller doesn't inject one.
 */
export function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** The message of an `Error`, or the `String(...)` form of any other value. */
export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Resolve after `ms` milliseconds (a `setTimeout`-backed sleep). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared encoder for {@link sha256Hex} (a `TextEncoder` is stateless and reusable). */
const encoder = new TextEncoder();

/**
 * The SHA-256 digest of `data` — a UTF-8 string or raw bytes — as a lowercase
 * hex string.
 *
 * Bytes are copied into a fresh `ArrayBuffer`-backed view so the digest input
 * type is unambiguous whatever buffer the source view sits on (e.g. a
 * `SharedArrayBuffer`).
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string"
    ? encoder.encode(data)
    : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Read a file's bytes, or `null` when it does not exist. */
export async function readFileOrNull(
  path: string,
): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Read a file's text, or `null` when it does not exist. */
export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/**
 * Stat a path, or `null` when it does not exist. `Deno.stat`, not `lstat`, so a
 * symlink to an existing file counts as present — which is what an installed
 * `bin` symlink needs.
 */
export async function statOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/**
 * The parent directory of a `/`- or `\`-separated path, or `null` when the path
 * has no parent to create (a bare name, or a root-level entry).
 */
function parentOf(path: string): string | null {
  const slashed = path.replace(/\\/g, "/");
  const slash = slashed.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

/** Write text to `path`, creating its parent directory first. */
export async function writeTextEnsuringDir(
  path: string,
  content: string,
): Promise<void> {
  const parent = parentOf(path);
  if (parent !== null) await Deno.mkdir(parent, { recursive: true });
  await Deno.writeTextFile(path, content);
}

/** Write bytes to `path`, creating its parent directory first. */
export async function writeFileEnsuringDir(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const parent = parentOf(path);
  if (parent !== null) await Deno.mkdir(parent, { recursive: true });
  await Deno.writeFile(path, bytes);
}

/**
 * Run `fn`, rejecting if it takes longer than `timeoutMs` (`undefined` → no
 * bound, so `fn` runs to completion). On a timeout the work keeps running in the
 * background but is orphaned — only the returned promise settles (with a
 * `timed out after <ms>ms` error).
 */
export function runWithTimeout(
  fn: () => unknown,
  timeoutMs: number | undefined,
): Promise<void> {
  // `.then(fn)` awaits a returned thenable (so the timeout still bounds an
  // async body); the second `.then` discards the value — a body's return is
  // ignored (see `TargetFn`).
  const result = Promise.resolve().then(fn).then(() => undefined);
  if (timeoutMs === undefined) return result;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    result.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
