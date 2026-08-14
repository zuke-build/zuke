// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The drift guard for the provider schemas. Each response shape is written
 * twice — once in the strict JSON Schema dialect (OpenAI, Claude) and once in
 * Gemini's OpenAPI subset — and the two are mechanically related: drop
 * `additionalProperties`, turn a `["x", "null"]` type into `x` plus
 * `nullable: true`, and drop the nullable names from `required`.
 *
 * Both literals stay hand-written, so each can be read against its own
 * provider's documentation; this test derives one from the other and fails on a
 * one-sided edit. The transformer lives here rather than in the package: the
 * shipped code needs no generic schema converter.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  ASSESSMENT_GEMINI_SCHEMA,
  ASSESSMENT_JSON_SCHEMA,
  verdictsGeminiSchema,
  verdictsJsonSchema,
} from "../src/schema.ts";
import { FIX_GEMINI_SCHEMA, FIX_JSON_SCHEMA } from "../src/fix_schema.ts";

/** Whether a value is a plain object the walk can descend into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Gemini dialect derived from a strict JSON Schema. */
function geminiOf(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nullable = new Set<string>();
  for (const [key, value] of Object.entries(schema)) {
    // `required` is rebuilt last: it depends on which properties are nullable.
    if (key === "additionalProperties" || key === "required") continue;
    if (key === "type" && Array.isArray(value)) {
      out.type = value.find((member) => member !== "null");
      out.nullable = true;
    } else if (key === "properties" && isRecord(value)) {
      const properties: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) {
        const converted = isRecord(sub) ? geminiOf(sub) : sub;
        if (isRecord(converted) && converted.nullable === true) {
          nullable.add(name);
        }
        properties[name] = converted;
      }
      out.properties = properties;
    } else if (key === "items" && isRecord(value)) {
      out.items = geminiOf(value);
    } else {
      out[key] = value;
    }
  }
  const required = schema.required;
  if (Array.isArray(required)) {
    out.required = required.filter((name) => !nullable.has(String(name)));
  }
  return out;
}

Deno.test("the assessment schemas are the same shape in both dialects", () => {
  assertEquals(geminiOf(ASSESSMENT_JSON_SCHEMA), ASSESSMENT_GEMINI_SCHEMA);
});

Deno.test("the verdict schemas are the same shape in both dialects", () => {
  const allowed = ["confirmed", "refuted"];
  assertEquals(
    geminiOf(verdictsJsonSchema(allowed)),
    verdictsGeminiSchema(allowed),
  );
});

Deno.test("the fix schemas are the same shape in both dialects", () => {
  assertEquals(geminiOf(FIX_JSON_SCHEMA), FIX_GEMINI_SCHEMA);
});
