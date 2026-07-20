/**
 * Severity ordering and normalisation.
 *
 * @module
 */

import type { Severity } from "./types.ts";

/** All severities from least to most severe. */
export const SEVERITY_ORDER: Severity[] = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
];

/** The numeric rank of a severity, for comparisons. */
export function rank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/**
 * A representative 0–10 risk score for a severity — the top of the band the
 * review rubric assigns (`low` 1–3, `medium` 4–6, `high` 7–8, `critical` 9–10).
 * Used to recompute an assessment's score after suppression removes findings,
 * so a score-based gate reflects what actually survived.
 */
export function severityScore(severity: Severity): number {
  const scores: Record<Severity, number> = {
    none: 0,
    low: 3,
    medium: 6,
    high: 8,
    critical: 10,
  };
  return scores[severity];
}

/** Normalise an unknown into a {@link Severity}, or `undefined`. */
export function toSeverity(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined;
  for (const severity of SEVERITY_ORDER) {
    if (severity === value) return severity;
  }
  return undefined;
}
