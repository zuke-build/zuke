// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading npm's `--json` output without casting.
 *
 * Internal to the package: not exported from `mod.ts`. npm's JSON is an
 * external input — a different npm version, a registry error, or an empty run
 * all change its shape — so the value-returning tasks narrow it with these
 * guards instead of asserting a type the payload may not have.
 *
 * @module
 */

/** A JSON object, with every value still unknown until it is narrowed. */
export type JsonRecord = Record<string, unknown>;

/** Whether `value` is a JSON object rather than an array, a scalar, or null. */
export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `stdout` as a JSON object, or `undefined` when it is empty or is not
 * one — which is what npm prints when a command had nothing to report, and
 * what a non-JSON error page from a proxy looks like.
 */
export function parseJsonRecord(stdout: string): JsonRecord | undefined {
  const text = stdout.trim();
  if (text === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The string at `key`, or `undefined` when it is absent or not a string. */
export function stringField(
  record: JsonRecord,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** The number at `key`, or `undefined` when it is absent or not a number. */
export function numberField(
  record: JsonRecord,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}
