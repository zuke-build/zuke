/**
 * Small filesystem helpers for build scripts — the operations a `clean` target
 * reaches for, with the missing-target tolerance that makes them idempotent.
 *
 * ```ts
 * import { remove } from "jsr:@zuke/core";
 *
 * await remove("dist", { recursive: true }); // like `rm -rf dist`
 * ```
 *
 * @module
 */

import type { PathLike } from "./path.ts";

/** Options for {@link remove}. */
export interface RemoveOptions {
  /** Remove a directory and its contents recursively (like `rm -r`). */
  recursive?: boolean;
}

/**
 * Remove `path`, tolerating a missing target the way `rm -f` does: a `NotFound`
 * error resolves to `false` instead of throwing. Any other error (e.g. a
 * non-empty directory removed without {@link RemoveOptions.recursive}, or a
 * permission failure) is rethrown rather than masked.
 *
 * @returns `true` if something was removed, `false` if `path` did not exist.
 */
export async function remove(
  path: PathLike,
  options: RemoveOptions = {},
): Promise<boolean> {
  try {
    await Deno.remove(String(path), { recursive: options.recursive ?? false });
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
