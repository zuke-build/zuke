/**
 * `@zuke/ai` — AI-powered code review for Zuke builds.
 *
 * Define a reviewer fluently and plug it into a target as a {@link
 * "jsr:@zuke/core".Validation} with `.validateBefore(...)` / `.validateAfter(...)`.
 * Only the provider and API key are required; everything else is defaulted.
 *
 * ```ts
 * import { Build, parameter, target } from "jsr:@zuke/core";
 * import { securityReviewer } from "jsr:@zuke/ai";
 *
 * class Pipeline extends Build {
 *   key = parameter("Anthropic API key").secret().required();
 *   security = securityReviewer((r) => r.provider("claude").apiKey(this.key));
 *   deploy = target().validateBefore(this.security).executes(async () => {});
 * }
 * ```
 *
 * @module
 */

export { AiReviewError } from "./src/errors.ts";
export type {
  Assessment,
  AssessmentFinding,
  AssessmentType,
  Effort,
  Provider,
  Severity,
  Usage,
} from "./src/types.ts";
export { AiFixer, aiFixer } from "./src/fixer.ts";
export type { Confidence, FileEdit, Fix, FixLocation } from "./src/fix.ts";
export { AgentFixer, agentFixer } from "./src/agent_fixer.ts";
export type {
  AgentContext,
  AgentResult,
  AgentRunner,
} from "./src/agent_fixer.ts";
export { DiffSettings } from "./src/diff.ts";
export { GateSettings } from "./src/gate.ts";
export type { RetryInfo, RetryOptions } from "./src/retry.ts";
export { Budget, budget, DEFAULT_PRICES } from "./src/budget.ts";
export type { BudgetSpend, ModelPrice } from "./src/budget.ts";
export { AiCache, aiCache } from "./src/cache.ts";
export type { CacheEntry, CacheStore } from "./src/cache.ts";
export {
  findingFingerprint,
  Suppressions,
  suppressions,
} from "./src/suppress.ts";
export {
  correctnessReviewer,
  genericReviewer,
  licenseReviewer,
  Reviewer,
  secretsReviewer,
  securityReviewer,
} from "./src/reviewer.ts";
export { aiReviewWorkflow, type AiReviewWorkflowSpec } from "./src/workflow.ts";
