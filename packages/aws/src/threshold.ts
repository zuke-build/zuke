// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bounds check of the `cloudwatch(...)` canary analysis. Internal to the
 * package.
 *
 * `@zuke/canary` has the same check for its `prometheus(...)` and
 * `metricThreshold(...)` analyses, and this one reports in the same words so
 * a rollout reads alike whichever analysis failed it. It is not imported
 * from there because a wrapper package depends on `@zuke/core` alone.
 *
 * @module
 */

/** Inclusive bounds a metric must stay within; either side may be open. */
export interface Bounds {
  /** The lowest acceptable value, if any. */
  min?: number;
  /** The highest acceptable value, if any. */
  max?: number;
}

/** The bounds `min` and `max` describe, refusing a set that cannot work. */
export function boundsOf(
  label: string,
  min: number | undefined,
  max: number | undefined,
): Bounds {
  if (min === undefined && max === undefined) {
    throw new Error(`"${label}" sets no bound — call .min(...) or .max(...).`);
  }
  // A NaN bound compares false both ways and would pass every reading.
  if (Number.isNaN(min) || Number.isNaN(max)) {
    throw new Error(`"${label}" has a bound that is not a number.`);
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(
      `"${label}" can never pass: its minimum ${min} is above its maximum ` +
        `${max}.`,
    );
  }
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/**
 * Throw when `value` is outside `bounds`, naming the metric. A CloudWatch
 * value arrives through JSON, which has no NaN, so unlike canary's check this
 * one has no NaN case to report.
 */
export function checkThreshold(
  label: string,
  value: number,
  bounds: Bounds,
): void {
  if (bounds.max !== undefined && value > bounds.max) {
    throw new Error(`${label} is ${value}, above the maximum ${bounds.max}.`);
  }
  if (bounds.min !== undefined && value < bounds.min) {
    throw new Error(`${label} is ${value}, below the minimum ${bounds.min}.`);
  }
}
