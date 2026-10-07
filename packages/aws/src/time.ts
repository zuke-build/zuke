// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Time ranges for the monitoring commands. Internal to the package.
 *
 * CloudWatch takes ISO 8601 timestamps, Logs Insights takes epoch seconds and
 * `filter-log-events` takes epoch milliseconds; every setter accepts a `Date`
 * and the conversion lives here, once. A `.window(duration)` is resolved when
 * the setter is called — inside the settings lambda, so at task time — which
 * keeps every `buildArgs()` free of a clock read.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";

/** A start and end time. */
export interface TimeRange {
  /** The start of the range. */
  start: Date;
  /** The end of the range. */
  end: Date;
}

/** The `duration` before `end`, as a range. */
export function windowEnding(duration: string | number, end: Date): TimeRange {
  const ms = parseDuration(duration);
  if (ms <= 0) {
    throw new Error(`A time window must be longer than zero, got ${duration}.`);
  }
  return { start: new Date(end.getTime() - ms), end };
}

/** Whole seconds since the epoch, as Logs Insights takes them. */
export function epochSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000));
}

/** Milliseconds since the epoch, as `filter-log-events` takes them. */
export function epochMilliseconds(date: Date): string {
  return String(date.getTime());
}
