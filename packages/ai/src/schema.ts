/**
 * The JSON schema for an {@link "./types.ts".Assessment}, in the dialects each
 * provider's structured-output mode expects. Sending it on the request makes
 * the response shape **enforced by the API** rather than merely requested in
 * the prompt — so the model can't quietly drift from it.
 *
 * @module
 */

import { SEVERITY_ORDER } from "./severity.ts";

/**
 * Strict JSON Schema for OpenAI structured outputs and Claude's
 * `output_config.format`. Optional fields are nullable and listed in `required`
 * (what strict mode demands); the parser already treats `null` as "absent".
 */
export const ASSESSMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer" },
    severity: { type: "string", enum: SEVERITY_ORDER },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: SEVERITY_ORDER },
          file: { type: ["string", "null"] },
          line: { type: ["integer", "null"] },
          detail: { type: ["string", "null"] },
        },
        required: ["title", "severity", "file", "line", "detail"],
      },
    },
  },
  required: ["score", "severity", "summary", "findings"],
};

/**
 * OpenAPI-subset schema for Gemini's `responseSchema`: `additionalProperties`
 * is unsupported there, and optionals use `nullable` instead of a `null` type.
 */
export const ASSESSMENT_GEMINI_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    score: { type: "integer" },
    severity: { type: "string", enum: SEVERITY_ORDER },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: SEVERITY_ORDER },
          file: { type: "string", nullable: true },
          line: { type: "integer", nullable: true },
          detail: { type: "string", nullable: true },
        },
        required: ["title", "severity"],
      },
    },
  },
  required: ["score", "severity", "summary", "findings"],
};
