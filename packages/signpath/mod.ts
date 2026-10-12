// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/signpath` — Authenticode signing through
 * [SignPath](https://about.signpath.io) from Zuke builds, and `signtool verify`
 * to check the result.
 *
 * `SignPathTasks.submit` submits a signing request, waits for SignPath to
 * finish it, and downloads the signed artifact. From GitHub Actions, have
 * SignPath fetch the artifact `actions/upload-artifact` uploaded and verify
 * the workflow run it came from — the route SignPath's open-source programme
 * requires:
 *
 * ```ts
 * import { SignPathTasks, SigntoolTasks } from "@zuke/signpath";
 *
 * await SignPathTasks.submit((s) =>
 *   s.organizationId(orgId).apiToken(token)
 *     .projectSlug("zuke").signingPolicySlug("release-signing")
 *     .gitHubOrigin((g) => g.artifactId(artifactId))
 *     .output("dist/signed/zuke.zip")
 * );
 * await SigntoolTasks.verify((s) =>
 *   s.authenticodePolicy().verbose().file("dist/signed/zuke.exe")
 * );
 * ```
 *
 * Elsewhere, upload the file directly with `.artifact(path)` instead of
 * `.gitHubOrigin(...)`. The API token never reaches a progress line or an
 * error message.
 *
 * @module
 */

export { SignPathConnectionSettings } from "./src/connection.ts";
export { SignPathDownloadSettings } from "./src/download.ts";
export {
  SignPathApiError,
  SignPathRequestError,
  SignPathSigningError,
  SignPathTimeoutError,
  SignPathValidationError,
  type SignPathValidationIssue,
} from "./src/errors.ts";
export { SignPathGitHubOriginSettings } from "./src/github_origin.ts";
export {
  type SigntoolHashAlgorithm,
  SigntoolTasks,
  type SigntoolTasksApi,
  SigntoolVerifySettings,
} from "./src/signtool.ts";
export { SignPathStatusSettings } from "./src/status.ts";
export { SignPathSubmitSettings } from "./src/submit_settings.ts";
export { SignPathTasks, type SignPathTasksApi } from "./src/tasks.ts";
export type {
  SignPathSignedArtifact,
  SignPathSigningRequestStatus,
  SignPathSubmission,
} from "./src/types.ts";
