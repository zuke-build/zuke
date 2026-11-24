// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Throwaway temp-directory scopes for the test suite. Every layer — unit,
 * integration and e2e — needs "a fresh directory, cleaned up afterwards", and
 * hand-rolling the `try`/`finally` in each test both repeats the cleanup and
 * repeats the mistake of letting a removal error mask the assertion failure the
 * test actually cares about.
 *
 * @module
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** Where a scope's directory goes, and the start of its name. */
export interface TempOptions {
  /** The parent directory, the system temp directory when unset. */
  dir?: string;
  /** The start of the directory's name. */
  prefix?: string;
}

/**
 * A fresh directory inside `options.dir`, or the system temp directory. An
 * empty prefix falls back too: `join` would drop the separator and make the
 * directory a sibling of its parent rather than a child.
 */
function makeTemp(options?: TempOptions): Promise<string> {
  return mkdtemp(join(options?.dir ?? tmpdir(), options?.prefix || "tmp-"));
}

/**
 * Remove `dir` best-effort. A removal error (e.g. a Windows file lock, or a
 * body that already deleted the directory) must never replace the test's own
 * failure, which is the error worth seeing.
 */
async function discard(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore — the temp dir is throwaway; masking the real error is worse.
  }
}

/**
 * Run `fn` against a fresh temp directory, removed afterwards even on failure.
 * `options` places the directory and names its `prefix`.
 */
export async function withTemp(
  fn: (dir: string) => void | Promise<void>,
  options?: TempOptions,
): Promise<void> {
  const dir = await makeTemp(options);
  try {
    await fn(dir);
  } finally {
    await discard(dir);
  }
}

/**
 * {@link withTemp}, with the process `cwd` switched into the temp directory for
 * the duration — for code under test that resolves paths relative to the
 * working directory. The original `cwd` is restored before the directory is
 * removed, so the removal cannot fail on "in use".
 */
export async function withTempCwd(
  fn: (dir: string) => void | Promise<void>,
  options?: TempOptions,
): Promise<void> {
  const dir = await makeTemp(options);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await fn(dir);
  } finally {
    process.chdir(cwd);
    await discard(dir);
  }
}
