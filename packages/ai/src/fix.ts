/**
 * The structured {@link Fix} a {@link "./fixer.ts".AiFixer} produces, and the
 * parser that turns a model's raw response into one. A fix is a diagnosis plus
 * a set of whole-file edits — full file contents, not patches, so applying a
 * fix is a deterministic write with no fuzzy hunk matching.
 *
 * @module
 */

import { AiReviewError } from "./errors.ts";
import { dig } from "./json.ts";

/** The model's confidence that a fix is correct. */
export type Confidence = "low" | "medium" | "high";

/** A whole-file edit: the complete new contents of one file. */
export interface FileEdit {
  /** Repository-relative path of the file to write. */
  path: string;
  /** The complete new contents of the file (not a patch). */
  content: string;
}

/** The structured result of a fix attempt. */
export interface Fix {
  /** A plain-English explanation of what failed and why. */
  diagnosis: string;
  /** The underlying root cause the fix addresses. */
  rootCause: string;
  /** The model's confidence that the edits resolve the failure. */
  confidence: Confidence;
  /** The whole-file edits that, applied together, should fix the failure. */
  edits: FileEdit[];
}

/** Normalise an unknown into a {@link Confidence}, defaulting to `"low"`. */
function toConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" ? value : "low";
}

/** Build the edit list from an unknown `edits` value, dropping malformed ones. */
function toEdits(value: unknown): FileEdit[] {
  if (!Array.isArray(value)) return [];
  const edits: FileEdit[] = [];
  for (const item of value) {
    const path = dig(item, "path");
    const content = dig(item, "content");
    if (
      typeof path === "string" && path !== "" && typeof content === "string"
    ) {
      edits.push({ path, content });
    }
  }
  return edits;
}

/** Strip Markdown code fences and isolate the JSON object in a response. */
function isolateJson(text: string): string {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const open = unfenced.indexOf("{");
  const close = unfenced.lastIndexOf("}");
  return open >= 0 && close > open ? unfenced.slice(open, close + 1) : unfenced;
}

/** Parse a model response into a validated {@link Fix}. */
export function parseFix(text: string): Fix {
  let raw: unknown;
  try {
    raw = JSON.parse(isolateJson(text));
  } catch {
    throw new AiReviewError("the model did not return valid JSON");
  }
  const diagnosis = dig(raw, "diagnosis");
  const rootCause = dig(raw, "rootCause");
  return {
    diagnosis: typeof diagnosis === "string" ? diagnosis : "",
    rootCause: typeof rootCause === "string" ? rootCause : "",
    confidence: toConfidence(dig(raw, "confidence")),
    edits: toEdits(dig(raw, "edits")),
  };
}
