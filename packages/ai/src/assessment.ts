/**
 * Turning a model's raw text response into a validated {@link Assessment}.
 *
 * @module
 */

import type { Assessment, AssessmentFinding } from "./types.ts";
import { AiReviewError } from "./errors.ts";
import { dig } from "./json.ts";
import { rank, toSeverity } from "./severity.ts";

/** Clamp an unknown score into the `0`–`10` range, defaulting to `0`. */
function clampScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value)));
}

/** The highest severity among the findings (or `none`). */
function maxSeverity(
  findings: AssessmentFinding[],
): AssessmentFinding["severity"] {
  let highest: AssessmentFinding["severity"] = "none";
  for (const f of findings) {
    if (rank(f.severity) > rank(highest)) highest = f.severity;
  }
  return highest;
}

/** Build the finding list from an unknown `findings` value. */
function toFindings(value: unknown): AssessmentFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: AssessmentFinding[] = [];
  for (const item of value) {
    const title = dig(item, "title");
    if (typeof title !== "string") continue;
    const file = dig(item, "file");
    const line = dig(item, "line");
    const detail = dig(item, "detail");
    findings.push({
      title,
      severity: toSeverity(dig(item, "severity")) ?? "low",
      ...(typeof file === "string" ? { file } : {}),
      ...(typeof line === "number" ? { line } : {}),
      ...(typeof detail === "string" ? { detail } : {}),
    });
  }
  return findings;
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

/** Parse a model response into a validated {@link Assessment}. */
export function parseAssessment(text: string): Assessment {
  let raw: unknown;
  try {
    raw = JSON.parse(isolateJson(text));
  } catch {
    throw new AiReviewError("the model did not return valid JSON");
  }
  const findings = toFindings(dig(raw, "findings"));
  const summary = dig(raw, "summary");
  return {
    score: clampScore(dig(raw, "score")),
    severity: toSeverity(dig(raw, "severity")) ?? maxSeverity(findings),
    summary: typeof summary === "string" ? summary : "",
    findings,
  };
}

/** A reviewer with nothing to review: a clean pass. */
export function emptyAssessment(): Assessment {
  return {
    score: 0,
    severity: "none",
    summary: "No changes to review.",
    findings: [],
  };
}
