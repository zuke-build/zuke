// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Times and durations for the monitoring commands. Internal to the package.
 *
 * Azure Monitor takes ISO 8601 timestamps and durations; every setter accepts
 * a `Date` (or a duration as `"15m"` or milliseconds) and the conversion lives
 * here, once. A `.window(duration)` is resolved when the setter is called —
 * inside the settings lambda, so at task time — which keeps every
 * `buildArgs()` free of a clock read.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";

/** A time given as a `Date` or as a string the CLI parses (ISO 8601). */
export type AzTime = Date | string;

/** A start and end time. */
interface TimeRange {
  /** The start of the range. */
  start: Date;
  /** The end of the range. */
  end: Date;
}

/** A time as the CLI takes it. */
export function iso(time: AzTime): string {
  return typeof time === "string" ? time : time.toISOString();
}

/**
 * A time as Key Vault's options take it: UTC to the second,
 * `2027-01-01T00:00:00Z`. Its parser accepts no fractional seconds, so a
 * `Date` drops them; a string is sent as written.
 */
export function utcSeconds(time: AzTime): string {
  return typeof time === "string"
    ? time
    : time.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `duration` in milliseconds, refused unless it is longer than zero. */
export function positiveDuration(duration: string | number): number {
  const ms = parseDuration(duration);
  if (ms <= 0) {
    throw new Error(`A time window must be longer than zero, got ${duration}.`);
  }
  return ms;
}

/** The `duration` before `end`, as a range. */
export function windowEnding(duration: string | number, end: Date): TimeRange {
  return { start: new Date(end.getTime() - positiveDuration(duration)), end };
}

/**
 * `ms` as an ISO 8601 duration in whole seconds — `PT300S` — the form
 * `--timespan` takes. Seconds alone are valid ISO 8601 and need no carrying
 * into minutes or hours.
 */
export function isoDuration(ms: number): string {
  return `PT${Math.max(1, Math.round(ms / 1000))}S`;
}

/**
 * `ms` in the CLI's `##d##h##m##s` shorthand, the form `--offset` takes.
 * Every unit is written, so the CLI's parser — which reads `m` as minutes —
 * has nothing to guess.
 */
export function shorthandDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${days}d${hours}h${minutes}m${seconds}s`;
}
