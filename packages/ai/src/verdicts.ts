/**
 * Parsing the verdict responses of the verify and adjudication passes.
 *
 * Both passes fail **safe**: a verdict that is missing, malformed, or names an
 * id the pass did not ask about is ignored, and an ignored verdict always
 * leaves the finding in its more-visible state (a candidate stays reported, a
 * contested finding stays open and gating). The model output can therefore
 * narrow what the reviewer says only along the exact axis the pass asked
 * about — never widen its own authority.
 *
 * @module
 */

import { isolateJson } from "./assessment.ts";
import { AiReviewError } from "./errors.ts";
import { dig } from "./json.ts";

/** One verdict returned by a verify or adjudication pass. */
export interface Verdict {
  /** The fingerprint of the finding the verdict is about. */
  id: string;
  /** The verdict value — one of the values the pass allowed. */
  verdict: string;
  /** The model's reasoning, when provided. */
  reason?: string;
}

/**
 * Parse a verdict response into the verdicts keyed by finding fingerprint.
 * Only entries with a string id and a verdict in `allowed` are kept — an
 * out-of-vocabulary verdict is dropped (fail-safe), not coerced. Invalid JSON
 * throws an {@link AiReviewError}, like the assessment parser.
 */
export function parseVerdicts(
  text: string,
  allowed: string[],
): Map<string, Verdict> {
  let raw: unknown;
  try {
    raw = JSON.parse(isolateJson(text));
  } catch {
    throw new AiReviewError("the model did not return valid verdict JSON");
  }
  const verdicts = new Map<string, Verdict>();
  const items = dig(raw, "verdicts");
  if (!Array.isArray(items)) return verdicts;
  for (const item of items) {
    const id = dig(item, "id");
    const verdict = dig(item, "verdict");
    if (typeof id !== "string" || typeof verdict !== "string") continue;
    if (!allowed.includes(verdict)) continue;
    const reason = dig(item, "reason");
    verdicts.set(id, {
      id,
      verdict,
      ...(typeof reason === "string" ? { reason } : {}),
    });
  }
  return verdicts;
}
