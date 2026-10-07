// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Type guards for the JSON the Azure CLI prints. Internal to the package: every
 * reader narrows a parsed document through these instead of asserting a type
 * onto it, so a response of an unexpected shape is reported, not trusted.
 *
 * @module
 */

/** A JSON object. */
type JsonRecord = Record<string, unknown>;

/** Whether `value` is a JSON object (not an array, not `null`). */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
