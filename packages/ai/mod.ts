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

export {
  AiReviewError,
  type Assessment,
  type AssessmentFinding,
  type AssessmentType,
  correctnessReviewer,
  DiffSettings,
  type Effort,
  GateSettings,
  genericReviewer,
  licenseReviewer,
  type Provider,
  Reviewer,
  secretsReviewer,
  securityReviewer,
  type Severity,
} from "./src/ai.ts";
