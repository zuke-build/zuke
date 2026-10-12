// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Readers that take a parsed SignPath answer apart without a type assertion.
 * A SignPath answer is untrusted input: a field of the wrong type is reported
 * by name rather than flowing into a typed result as `undefined`.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/** Whether `value` is a plain JSON object (not an array, not `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An object's own property, never one inherited through its prototype — so an
 * answer carrying `__proto__` or `constructor` reads as data.
 */
export function own(object: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** A non-empty string field, or `undefined` when absent, empty or not a string. */
export function optionalString(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = own(object, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `text` parsed as JSON, or `undefined` when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
