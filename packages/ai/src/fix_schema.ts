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
  required: ["diagnosis", "rootCause", "confidence", "edits"],
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
  required: ["diagnosis", "rootCause", "confidence", "edits"],
};
