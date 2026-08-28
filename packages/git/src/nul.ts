// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Splitting the NUL-delimited output the `-z` forms of git's plumbing produce.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so `status`,
 * `diff`, and `ls-files` share one reading of that format — a path is the only
 * thing git cannot put a NUL inside, which is why the `-z` forms are the only
 * safe way to read a list of paths back.
 *
 * @module
 */

/**
 * The records of a NUL-delimited listing, with the trailing empty field git's
 * final terminator leaves behind removed. An empty (or whitespace-only) output
 * yields no records rather than one empty one.
 */
export function splitNul(stdout: string): string[] {
  return stdout.split("\0").filter((field) => field !== "");
}
