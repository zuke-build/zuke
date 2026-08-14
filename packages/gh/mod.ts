// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/gh` — typed GitHub tooling for Zuke builds: the `gh` (GitHub CLI) task
 * wrapper plus {@link githubWorkflow}, a wait trigger that dispatches and awaits
 * an external GitHub Actions workflow.
 *
 * ```ts
 * import { GhTasks, githubWorkflow } from "jsr:@zuke/gh";
 *
 * await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
 *
 * // In a build: suspend until an e2e workflow in another repo finishes.
 * e2e = target().waitsFor((s) =>
 *   s.on(githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml")))
 * );
 * ```
 *
 * @module
 */

export * from "./src/gh.ts";
export {
  assertRefName,
  commitFiles,
  GhApiError,
  type GhCommitApi,
  type GhCommitResult,
  GhCommitSettings,
  GhTagSettings,
  tagCommit,
} from "./src/commit.ts";
export {
  type GhCheckConclusion,
  type GhCheckRunApi,
  type GhCheckRunResult,
  GhCheckRunSettings,
  postCheckRun,
} from "./src/check_run.ts";
export {
  type GhAppTokenApi,
  type GhAppTokenResult,
  GhAppTokenSettings,
  type GhPermissionLevel,
  mintAppToken,
} from "./src/app_token.ts";
export {
  type GhSarifApi,
  GhSarifSettings,
  type GhSarifUploadResult,
  uploadSarifReport,
} from "./src/sarif.ts";
export {
  type GhReleaseAssetApi,
  type GhReleaseAssetResult,
  GhReleaseAssetSettings,
  uploadReleaseAsset,
} from "./src/release_asset.ts";
export {
  type GhReleaseLatestApi,
  type GhReleaseLatestResult,
  GhReleaseLatestSettings,
  markReleaseLatest,
} from "./src/release_latest.ts";
export {
  type CorrelateMode,
  githubWorkflow,
  GithubWorkflowSettings,
  readWorkflowResult,
  WorkflowCorrelationError,
  type WorkflowJob,
  type WorkflowResult,
} from "./src/workflow.ts";
export {
  findPullRequest,
  type GhPullRequestApi,
  type GhPullRequestResult,
  GhPullRequestSettings,
  openPullRequest,
} from "./src/pull_request.ts";
