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

/**
 * Remove `dir` best-effort. A removal error (e.g. a Windows file lock, or a
 * body that already deleted the directory) must never replace the test's own
 * failure, which is the error worth seeing.
 */
async function discard(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // ignore — the temp dir is throwaway; masking the real error is worse.
  }
}

/**
 * Run `fn` against a fresh temp directory, removed afterwards even on failure.
 * `options` is passed straight to `Deno.makeTempDir` (tests that want a
 * recognisable `prefix`).
 */
export async function withTemp(
  fn: (dir: string) => void | Promise<void>,
  options?: Deno.MakeTempOptions,
): Promise<void> {
  const dir = await Deno.makeTempDir(options);
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
  options?: Deno.MakeTempOptions,
): Promise<void> {
  const dir = await Deno.makeTempDir(options);
  const cwd = Deno.cwd();
  try {
    Deno.chdir(dir);
    await fn(dir);
  } finally {
    Deno.chdir(cwd);
    await discard(dir);
  }
}
