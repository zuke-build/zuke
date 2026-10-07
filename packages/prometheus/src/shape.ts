// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Readers that take a parsed Prometheus response apart without a type
 * assertion, and say which field was missing when the shape is wrong.
 *
 * Every endpoint's parser reads through these, so a response that is not what
 * the API reference describes fails with a message naming the field rather
 * than as `undefined` flowing into a typed result. A thrown message here is
 * wrapped by the transport into a {@link "./errors.ts".PrometheusRequestError}
 * naming the endpoint.
 *
 * @module
 */

import type { PrometheusLabels } from "./types.ts";

/** Whether `value` is a plain JSON object (not an array, not `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as an object, or an error naming `what`. */
export function readRecord(
  value: unknown,
  what: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

/** `value` as an array, or an error naming `what`. */
export function readArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value;
}

/**
 * An object's own property, never one inherited through its prototype — so a
 * response carrying `__proto__` or `constructor` reads as data, not as
 * `Object.prototype`.
 */
export function own(object: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** A required string field. */
export function readString(
  object: Record<string, unknown>,
  key: string,
  what: string,
): string {
  const value = own(object, key);
  if (typeof value !== "string") throw new Error(`${what} has no ${key}`);
  return value;
}

/** An optional string field: absent is `undefined`, any other type is an error. */
export function readOptionalString(
  object: Record<string, unknown>,
  key: string,
  what: string,
): string | undefined {
  const value = own(object, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${what} has a ${key} that is not a string`);
  }
  return value;
}

/** A required number field. */
export function readNumber(
  object: Record<string, unknown>,
  key: string,
  what: string,
): number {
  const value = own(object, key);
  if (typeof value !== "number") throw new Error(`${what} has no ${key}`);
  return value;
}

/** An optional number field: absent is `undefined`, any other type is an error. */
export function readOptionalNumber(
  object: Record<string, unknown>,
  key: string,
  what: string,
): number | undefined {
  const value = own(object, key);
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new Error(`${what} has a ${key} that is not a number`);
  }
  return value;
}

/** An array of strings, or an error naming `what`. */
export function readStringArray(value: unknown, what: string): string[] {
  return readArray(value, what).map((item) => {
    if (typeof item !== "string") {
      throw new Error(`${what} holds a value that is not a string`);
    }
    return item;
  });
}

/**
 * A label set — an object of string values. Copied into a fresh object, so the
 * result never shares a prototype trick with the parsed JSON.
 */
export function readLabels(value: unknown, what: string): PrometheusLabels {
  const object = readRecord(value, what);
  const labels: Record<string, string> = {};
  for (const [name, label] of Object.entries(object)) {
    if (typeof label !== "string") {
      throw new Error(`${what} has a label ${name} that is not a string`);
    }
    Object.defineProperty(labels, name, {
      value: label,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return labels;
}

/** An optional label set: absent reads as the empty set, which it means. */
export function readOptionalLabels(
  object: Record<string, unknown>,
  key: string,
  what: string,
): PrometheusLabels {
  const value = own(object, key);
  return value === undefined ? {} : readLabels(value, `${what} ${key}`);
}
