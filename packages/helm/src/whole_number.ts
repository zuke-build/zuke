// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one check for a count helm takes as a whole number from 1 up — a
 * revision, a replica total. Internal to the package: not exported from
 * `mod.ts`.
 *
 * @module
 */

/** Whether `value` is a whole number from 1 up, small enough to be exact. */
export function isWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}
