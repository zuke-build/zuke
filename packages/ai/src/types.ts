/**
 * Shared types for `@zuke/ai`: providers, assessment kinds, and the structured
 * {@link Assessment} a review produces.
 *
 * @module
 */

/** A supported model provider. */
export type Provider = "claude" | "openai" | "gemini";

/** The kind of review an assessment performs. */
export type AssessmentType =
  | "generic"
  | "security"
  | "secrets"
  | "correctness"
  | "license";

/** A severity level, ordered `none` < `low` < `medium` < `high` < `critical`. */
export type Severity = "none" | "low" | "medium" | "high" | "critical";

/** The thinking-depth hint passed to providers that support it (Claude). */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A single issue reported by the model. */
export interface AssessmentFinding {
  /** A short title for the issue. */
  title: string;
  /** The issue's severity. */
  severity: Severity;
  /** The file the issue is in, if the model attributed one. */
  file?: string;
  /** The line the issue is at, if the model attributed one. */
  line?: number;
  /** A longer explanation, if provided. */
  detail?: string;
}

/** The structured result of a review. */
export interface Assessment {
  /** Overall risk score, `0` (none) to `10` (severe). */
  score: number;
  /** The overall severity. */
  severity: Severity;
  /** A one-line summary of the assessment. */
  summary: string;
  /** The individual findings. */
  findings: AssessmentFinding[];
}

/**
 * Token counts a provider reported for a review call, when the response carries
 * them. Each field is optional because not every provider reports every count.
 */
export interface Usage {
  /** Tokens in the prompt / input. */
  inputTokens?: number;
  /** Tokens in the model's output / completion. */
  outputTokens?: number;
  /** Total tokens, reported by the provider or derived from input + output. */
  totalTokens?: number;
}
