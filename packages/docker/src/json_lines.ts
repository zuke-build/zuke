// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading the newline-delimited JSON docker's `--format '{{json .}}'` emits.
 *
 * Internal to the package: not exported from `mod.ts`. Every listing command
 * (`ps`, `images`, `volume ls`, `network ls`) can print one JSON object per
 * line this way, on every docker version worth supporting — unlike
 * `--format json`, which is recent-only and wraps the whole listing in an
 * array. Parsing it here means the value-returning tasks share one reading of
 * that format, and one decision about what to do with a line that is not an
 * object.
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
 * Parse newline-delimited JSON into records. A blank line, or one that is not
 * a JSON object, is skipped rather than throwing: docker interleaves warnings
 * ("the legacy builder is deprecated") into the same stream, and one of those
 * must not lose the whole listing.
 */
export function parseJsonLines(stdout: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (text === "" || !text.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (isJsonRecord(parsed)) records.push(parsed);
    } catch {
      // A truncated or non-JSON line is not a record; the rest still are.
    }
  }
  return records;
}

/** The string at `key`, or `undefined` when it is absent or not a string. */
export function stringField(
  record: JsonRecord,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The non-empty lines of a plain `--format '{{.Name}}'` listing, which is how
 * the name-only readers ask docker for exactly one column.
 */
export function parseLines(stdout: string): string[] {
  return stdout.split("\n").map((line) => line.trim()).filter((line) =>
    line !== ""
  );
}
