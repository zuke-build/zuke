// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Taking a JSON response apart without casting it.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/** A JSON object. */
export type JsonObject = { [key: string]: unknown };

/** Whether `value` is a JSON object. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value[key]` when it is a string, else `undefined`. */
export function stringAt(value: unknown, key: string): string | undefined {
  const found = isObject(value) ? value[key] : undefined;
  return typeof found === "string" ? found : undefined;
}

/** `value[key]` when it is a number, else `undefined`. */
export function numberAt(value: unknown, key: string): number | undefined {
  const found = isObject(value) ? value[key] : undefined;
  return typeof found === "number" ? found : undefined;
}
