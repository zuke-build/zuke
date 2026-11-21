// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The JSON-shape guards the scaffolder's file merges share (`deno.json`,
 * `.mcp.json`), and the one forgiving read of a `zuke.json` field that the
 * readers of its `build` and `runtime` fields share. Kept apart from all of
 * them so none has to import another for it.
 *
 * @module
 */

/** Whether `value` is a plain object (a JSON object, not an array or null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Field `field` of the JSON object `text`, or `undefined` when there is no such
 * field, and also when `text` is not JSON or not an object: a `zuke.json`'s
 * presence alone marked a project before its fields existed, so an empty or
 * malformed one means every field's default. Each field's reader decides
 * whether the value it gets is valid.
 */
export function forgivingField(text: string, field: string): unknown {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isRecord(config) ? config[field] : undefined;
}
