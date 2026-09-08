// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The library being released by the `release-library` example. Trivial on
 * purpose — the release routine in `zuke.ts` is the point.
 *
 * @module
 */

/** Clamp `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
