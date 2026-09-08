// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one JSON-shape guard the scaffolder's file merges share (`deno.json`,
 * `.mcp.json`). Kept apart from both so neither module has to import the
 * other for it.
 *
 * @module
 */

/** Whether `value` is a plain object (a JSON object, not an array or null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
