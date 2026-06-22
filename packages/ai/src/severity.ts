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

/** Normalise an unknown into a {@link Severity}, or `undefined`. */
export function toSeverity(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined;
  for (const severity of SEVERITY_ORDER) {
    if (severity === value) return severity;
  }
  return undefined;
}
