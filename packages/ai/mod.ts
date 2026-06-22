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
} from "./src/types.ts";
export { DiffSettings } from "./src/diff.ts";
export { GateSettings } from "./src/gate.ts";
export {
  correctnessReviewer,
  genericReviewer,
  licenseReviewer,
  Reviewer,
  secretsReviewer,
  securityReviewer,
} from "./src/reviewer.ts";
