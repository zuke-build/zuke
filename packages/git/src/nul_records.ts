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
 * The file is `nul_records.ts` rather than `nul.ts` because `NUL` is a
 * reserved DOS device name: Windows still resolves it with any extension, so
 * git refuses to check a `nul.ts` out at all (`error: invalid path`) and every
 * Windows job dies before it runs. `tests/reserved_filenames_test.ts` keeps
 * that from being rediscovered the hard way.
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
