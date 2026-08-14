// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Shape checks for JSON that arrived from somewhere Zuke does not control — a
 * stored record, or a response from a state-api service. {@link asObject}
 * narrows a value to a plain object without a cast, and {@link fields} binds one
 * message prefix to the required/optional field readers, so every rejection
 * names the subject and the field.
 *
 * This module is **internal**: it is not re-exported from `mod.ts` (or any
 * entrypoint), so nothing here is public API — the same posture as
 * {@link "./internal.ts"}. It exists so the run-record, lock-record and
 * build-descriptor parsers share one implementation of these checks instead of a
 * copy each.
 *
 * @module
 */

/** Narrow an unknown value to a plain object without casting, else `null`. */
export function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

/** The field readers {@link fields} binds to one message prefix. */
export interface FieldReaders {
  /** Read a required string field, throwing a descriptive error if it is not one. */
  str(object: Record<string, unknown>, field: string): string;
  /** Read an optional string field, throwing if present but not a string. */
  optionalStr(
    object: Record<string, unknown>,
    field: string,
  ): string | undefined;
  /** Read a required array-of-strings field, throwing if it is not one. */
  strArray(object: Record<string, unknown>, field: string): string[];
}

/**
 * Bind `subject` — the message prefix naming what is being parsed, e.g.
 * `state: run record field` or `registry: descriptor field` — to the field
 * readers, so a rejection reads `<subject> "<field>" is not a string`.
 */
export function fields(subject: string): FieldReaders {
  return {
    str(object: Record<string, unknown>, field: string): string {
      const value = object[field];
      if (typeof value !== "string") {
        throw new Error(`${subject} "${field}" is not a string`);
      }
      return value;
    },
    optionalStr(
      object: Record<string, unknown>,
      field: string,
    ): string | undefined {
      const value = object[field];
      if (value === undefined) return undefined;
      if (typeof value !== "string") {
        throw new Error(`${subject} "${field}" is not a string`);
      }
      return value;
    },
    strArray(object: Record<string, unknown>, field: string): string[] {
      const value = object[field];
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new Error(`${subject} "${field}" is not a string array`);
      }
      return value.filter((v): v is string => typeof v === "string");
    },
  };
}
