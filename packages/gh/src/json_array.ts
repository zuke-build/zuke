// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading the JSON array gh's `--json` prints.
 *
 * Internal to the package: not exported from `mod.ts`. Every `gh … list`
 * answers with an array of objects when given `--json`, so the
 * value-returning tasks share one reading of it — and one decision about what
 * an unexpected payload means, which is "nothing to report" rather than a
 * thrown error, because gh prints `[]` for an empty listing and a plain
 * message when it has something else to say.
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
 * Parse gh's `--json` output into records. A payload that is not an array of
 * objects yields none: gh prints `[]` when a listing is empty, and prose when
 * it is reporting something other than data.
 */
export function parseJsonArray(stdout: string): JsonRecord[] {
  const text = stdout.trim();
  if (text === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isJsonRecord);
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

/** The boolean at `key`, or `undefined` when it is absent or not a boolean. */
export function booleanField(
  record: JsonRecord,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The `login` of a nested user object, as gh nests an author or an assignee —
 * `{"author":{"login":"someone"}}`.
 */
export function loginField(
  record: JsonRecord,
  key: string,
): string | undefined {
  const value = record[key];
  return isJsonRecord(value) ? stringField(value, "login") : undefined;
}
