/**
 * The gate that decides whether an {@link Assessment} breaks the build.
 *
 * @module
 */

import type { Assessment, Severity } from "./types.ts";
import { rank } from "./severity.ts";

/** A configured rule for {@link "./reviewer.ts".Reviewer.failWhen}. */
export type GateRule =
  | { kind: "score"; value: number }
  | { kind: "severity"; value: Severity };

/** Fluent gate configuration passed to {@link "./reviewer.ts".Reviewer.failWhen}. */
export class GateSettings {
  readonly #rules: GateRule[] = [];

  /** Fail when the assessed risk score is strictly above `value` (0–10). */
  scoreAbove(value: number): this {
    this.#rules.push({ kind: "score", value });
    return this;
  }

  /** Fail when the overall severity is at least `value`. */
  severityAtLeast(value: Severity): this {
    this.#rules.push({ kind: "severity", value });
    return this;
  }

  /** The configured gate rules, in the order they were added. */
  rules_(): GateRule[] {
    return this.#rules;
  }
}

/** A short human description of the gate rules, e.g. `score>8` or `severity≥high`. */
export function describeGate(rules: GateRule[]): string {
  if (rules.length === 0) return "none";
  return rules
    .map((r) => r.kind === "score" ? `score>${r.value}` : `severity≥${r.value}`)
    .join(", ");
}

/** Whether an assessment trips the gate, and the human-readable reason. */
export function gateTrips(
  assessment: Assessment,
  rules: GateRule[],
): { tripped: boolean; reason: string } {
  for (const rule of rules) {
    if (rule.kind === "score" && assessment.score > rule.value) {
      return {
        tripped: true,
        reason: `risk score ${assessment.score} exceeds ${rule.value}`,
      };
    }
    if (
      rule.kind === "severity" &&
      rank(assessment.severity) >= rank(rule.value)
    ) {
      return {
        tripped: true,
        reason: `severity "${assessment.severity}" is at least "${rule.value}"`,
      };
    }
  }
  return { tripped: false, reason: "" };
}
