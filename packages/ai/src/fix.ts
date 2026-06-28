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

/**
 * A specific code location the fix targets: the exact offending source quoted
 * verbatim, its file and line(s), and the suggested replacement. Rendered as a
 * diff in the report so the comment shows real code, not just prose.
 */
export interface FixLocation {
  /** Repository-relative path of the file. */
  file: string;
  /** The 1-based line where the offending code starts. */
  line: number;
  /** The 1-based line where it ends, when it spans more than one line. */
  endLine?: number;
  /** The exact offending source line(s), quoted verbatim. */
  code: string;
  /** The suggested replacement for {@link code} (empty means delete it). */
  suggestion?: string;
}

/** The structured result of a fix attempt. */
export interface Fix {
  /** A one-line explanation of what failed and why. */
  diagnosis: string;
  /** The underlying root cause the fix addresses. */
  rootCause: string;
  /** The model's confidence that the edits resolve the failure. */
  confidence: Confidence;
  /** The specific code locations the fix targets, with verbatim source. */
  locations: FixLocation[];
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

/** Build the location list from an unknown `locations` value. */
function toLocations(value: unknown): FixLocation[] {
  if (!Array.isArray(value)) return [];
  const locations: FixLocation[] = [];
  for (const item of value) {
    const file = dig(item, "file");
    const line = dig(item, "line");
    const code = dig(item, "code");
    if (
      typeof file !== "string" || file === "" ||
      typeof line !== "number" || typeof code !== "string"
    ) {
      continue;
    }
    const endLine = dig(item, "endLine");
    const suggestion = dig(item, "suggestion");
    locations.push({
      file,
      line,
      code,
      ...(typeof endLine === "number" ? { endLine } : {}),
      ...(typeof suggestion === "string" ? { suggestion } : {}),
    });
  }
  return locations;
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
    locations: toLocations(dig(raw, "locations")),
    edits: toEdits(dig(raw, "edits")),
  };
}
