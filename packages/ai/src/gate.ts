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
  readonly rules_: GateRule[] = [];

  /** Fail when the assessed risk score is strictly above `value` (0–10). */
  scoreAbove(value: number): this {
    this.rules_.push({ kind: "score", value });
    return this;
  }

  /** Fail when the overall severity is at least `value`. */
  severityAtLeast(value: Severity): this {
    this.rules_.push({ kind: "severity", value });
    return this;
  }
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
