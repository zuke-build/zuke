/**
 * The JSON schema for a {@link "./fix.ts".Fix}, in the dialects each provider's
 * structured-output mode expects — mirroring `./schema.ts` for assessments.
 * Sending it on the request makes the response shape **enforced by the API**
 * rather than merely requested in the prompt.
 *
 * @module
 */

/** The confidence levels a fix may report. */
const CONFIDENCE = ["low", "medium", "high"];

/**
 * Strict JSON Schema for OpenAI structured outputs and Claude's
 * `output_config.format`.
 */
export const FIX_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    diagnosis: { type: "string" },
    rootCause: { type: "string" },
    confidence: { type: "string", enum: CONFIDENCE },
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          endLine: { type: ["integer", "null"] },
          code: { type: "string" },
          suggestion: { type: ["string", "null"] },
        },
        required: ["file", "line", "endLine", "code", "suggestion"],
      },
    },
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  required: ["diagnosis", "rootCause", "confidence", "locations", "edits"],
};

/**
 * OpenAPI-subset schema for Gemini's `responseSchema`: `additionalProperties`
 * is unsupported there.
 */
export const FIX_GEMINI_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    rootCause: { type: "string" },
    confidence: { type: "string", enum: CONFIDENCE },
    locations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          endLine: { type: "integer", nullable: true },
          code: { type: "string" },
          suggestion: { type: "string", nullable: true },
        },
        required: ["file", "line", "code"],
      },
    },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  required: ["diagnosis", "rootCause", "confidence", "locations", "edits"],
};
