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

import process from "node:process";
import { FileTasks, RuntimeTasks } from "@zuke/core";

/** Where a scope's directory goes, and the start of its name. */
export interface TempOptions {
  /** The parent directory, the system temp directory when unset. */
  dir?: string;
  /** The start of the directory's name. */
  prefix?: string;
}

/**
 * A fresh directory inside `options.dir`, or the system temp directory, made
 * through core's file tasks like the code under test.
 */
export async function makeTempDir(options?: TempOptions): Promise<string> {
  const prefix = options?.prefix ?? "tmp-";
  if (options?.dir === undefined) {
    return await FileTasks.makeTempDirectory((s) => s.prefix(prefix));
  }
  const dir = `${options.dir}/${prefix}${crypto.randomUUID()}`;
  await FileTasks.createDirectory(dir, { recursive: false });
  return dir;
}

/**
 * Remove `dir` best-effort. A removal error (e.g. a Windows file lock, or a
 * body that already deleted the directory) must never replace the test's own
 * failure, which is the error worth seeing.
 */
async function discard(dir: string): Promise<void> {
  try {
    await FileTasks.remove(dir, { recursive: true });
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
  const dir = await makeTempDir(options);
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
  const dir = await makeTempDir(options);
  const cwd = RuntimeTasks.cwd();
  try {
    chdir(dir);
    await fn(dir);
  } finally {
    chdir(cwd);
    await discard(dir);
  }
}

/**
 * Change the process's working directory. Core reads it but never changes
 * it, so a test that must move comes here; {@link withTempCwd}, which moves
 * back, is the better fit wherever the move has a scope.
 */
export function chdir(dir: string): void {
  process.chdir(dir);
}
