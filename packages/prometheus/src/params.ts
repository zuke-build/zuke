// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Rendering setter values into the API's parameter text — times, durations
 * and counts — and checking them where they are set, so a bad value fails in
 * the build file's lambda rather than as a `bad_data` from the server.
 *
 * @module
 */

import type { PrometheusDuration, PrometheusTime } from "./types.ts";

/**
 * A time as the API's `<rfc3339 | unix_timestamp>`: a `Date` as RFC 3339, a
 * number as Unix seconds, text as given.
 */
export function formatTime(time: PrometheusTime, what: string): string {
  if (time instanceof Date) {
    if (Number.isNaN(time.getTime())) {
      throw new Error(`${what} was given an invalid Date.`);
    }
    return time.toISOString();
  }
  if (typeof time === "number") {
    if (!Number.isFinite(time)) {
      throw new Error(`${what} must be finite Unix seconds, got ${time}.`);
    }
    return String(time);
  }
  return nonEmpty(time, what);
}

/** A duration as the API's `<duration | float>`: text as given, a number as seconds. */
export function formatDuration(
  duration: PrometheusDuration,
  what: string,
): string {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`${what} must be a positive number of seconds.`);
    }
    return String(duration);
  }
  return nonEmpty(duration, what);
}

/** A count such as `limit`: a whole number, zero or more (0 means "no limit"). */
export function formatCount(count: number, what: string): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${what} must be a whole number, zero or more.`);
  }
  return String(count);
}

/** `text`, refusing the empty string a missing value usually is. */
export function nonEmpty(text: string, what: string): string {
  if (text === "") throw new Error(`${what} was given an empty value.`);
  return text;
}

/**
 * The parameters a settings object set, in order, skipping the unset ones —
 * so a call sends exactly what the lambda named and nothing the server would
 * read as an explicit empty value.
 */
export function definedParams(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  for (const [name, value] of entries) {
    if (value !== undefined) params.push([name, value]);
  }
  return params;
}
