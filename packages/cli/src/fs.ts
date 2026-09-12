// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one filesystem probe the package's `Deno`-backed hosts share, so the
 * scaffolder's host and the dispatcher's probe agree on what "absent" means.
 *
 * @module
 */

/** Whether a path exists — the link itself, not its target. */
export async function exists(path: string): Promise<boolean> {
  return await lstatOrNull(path) !== null;
}

/**
 * `Deno.lstat` a path, or `null` when nothing is there. Reads the link itself
 * rather than its target, so a symlink is reported as a symlink instead of as
 * whatever it points at. A `NotFound` maps to `null`; any other error (e.g. a
 * permission failure) is rethrown rather than masked as absence.
 */
export async function lstatOrNull(
  path: string,
): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
