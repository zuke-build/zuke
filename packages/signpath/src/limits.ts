// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one check every numeric limit setter applies, so a `NaN`, a negative or
 * a zero cannot quietly turn a bound off: `NaN` compares false against
 * everything, so a `NaN` size cap would let any download through and a zero
 * poll interval would hammer SignPath for the whole wait.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/**
 * `value` when it is a whole number of at least `min`, else an error naming
 * the setter.
 */
export function wholeAtLeast(
  value: number,
  min: number,
  setter: string,
): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(
      `${setter} needs a whole number of at least ${min}, not ${value}.`,
    );
  }
  return value;
}
