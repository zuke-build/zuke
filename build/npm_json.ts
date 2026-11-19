// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The JSON helpers the `npmVerify` modules share: narrowing an unknown value,
 * reading a nested field, and comparing JSON the way npm sees it.
 */

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at `path` in nested records, or `undefined`. */
export function dig(value: unknown, ...path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** `value` with every object's keys sorted, so equal JSON serialises equally. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, canonical(inner)]),
  );
}

/** `value` as npm sees it: empty objects and arrays, `null` and `false` are absent. */
export function present(value: unknown): unknown {
  if (value === null || value === false) return undefined;
  if (Array.isArray(value)) return value.length === 0 ? undefined : value;
  if (isRecord(value)) {
    return Object.keys(value).length === 0 ? undefined : value;
  }
  return value;
}
