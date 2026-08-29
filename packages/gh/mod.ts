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
  GhBodySettings,
  GhCommandSettings,
  GhReadSettings,
  GhWebReadSettings,
} from "./src/subcommand.ts";
export type { GhIssueApi, GhPrApi, GhReleaseApi } from "./src/groups.ts";
export {
  type GhMergeMethod,
  GhPrChecksSettings,
  GhPrCloseSettings,
  GhPrCommentSettings,
  GhPrCreateSettings,
  GhPrEditSettings,
  GhPrListSettings,
  GhPrMergeSettings,
  GhPrReadSettings,
  GhPrTargetSettings,
  GhPrViewSettings,
  type GhPullRequestEntry,
  PR_LIST_FIELDS,
} from "./src/pr.ts";
export {
  type GhCloseReason,
  GhIssueCloseSettings,
  GhIssueCommentSettings,
  GhIssueCreateSettings,
  type GhIssueEntry,
  GhIssueListSettings,
  GhIssueViewSettings,
  ISSUE_LIST_FIELDS,
} from "./src/issue.ts";
export {
  GhReleaseCreateSettings,
  GhReleaseDeleteSettings,
  GhReleaseDownloadSettings,
  GhReleaseEditSettings,
  type GhReleaseEntry,
  GhReleaseListSettings,
  GhReleaseUploadSettings,
  GhReleaseViewSettings,
  RELEASE_LIST_FIELDS,
} from "./src/release.ts";
export type {
  GhCacheApi,
  GhRunApi,
  GhSecretApi,
  GhVariableApi,
  GhWorkflowApi,
} from "./src/actions_tasks.ts";
export type { GhLabelApi, GhRepoApi } from "./src/repo_tasks.ts";
export {
  GhRunCancelSettings,
  GhRunDeleteSettings,
  GhRunDownloadSettings,
  type GhRunEntry,
  GhRunListSettings,
  GhRunRerunSettings,
  type GhRunStatus,
  GhRunTargetSettings,
  GhRunViewSettings,
  GhRunWatchSettings,
  RUN_LIST_FIELDS,
} from "./src/actions_run.ts";
export {
  GhWorkflowDisableSettings,
  GhWorkflowEnableSettings,
  type GhWorkflowEntry,
  GhWorkflowListSettings,
  GhWorkflowRunSettings,
  GhWorkflowTargetSettings,
  GhWorkflowViewSettings,
  WORKFLOW_LIST_FIELDS,
} from "./src/workflow_command.ts";
export {
  type GhSecretApp,
  GhSecretDeleteSettings,
  type GhSecretEntry,
  GhSecretListSettings,
  GhSecretScopeSettings,
  GhSecretSetSettings,
  SECRET_LIST_FIELDS,
} from "./src/secret.ts";
export {
  GhVariableDeleteSettings,
  type GhVariableEntry,
  GhVariableGetSettings,
  GhVariableListSettings,
  GhVariableSetSettings,
  VARIABLE_LIST_FIELDS,
} from "./src/variable.ts";
export {
  CACHE_LIST_FIELDS,
  GhCacheDeleteSettings,
  type GhCacheEntry,
  GhCacheListSettings,
  type GhCacheSort,
} from "./src/cache.ts";
export {
  GhLabelCloneSettings,
  GhLabelCreateSettings,
  GhLabelDeleteSettings,
  GhLabelEditSettings,
  type GhLabelEntry,
  GhLabelListSettings,
  type GhLabelSort,
  LABEL_LIST_FIELDS,
} from "./src/label.ts";
export {
  GhRepoArchiveSettings,
  GhRepoCloneSettings,
  GhRepoCommandSettings,
  GhRepoCreateSettings,
  GhRepoDeleteSettings,
  GhRepoEditSettings,
  GhRepoForkSettings,
  GhRepoListSettings,
  GhRepoRenameSettings,
  GhRepoSetDefaultSettings,
  type GhRepositoryEntry,
  GhRepoSyncSettings,
  GhRepoViewSettings,
  type GhRepoVisibility,
  REPO_LIST_FIELDS,
} from "./src/repo.ts";
export type { GhScopeVisibility } from "./src/actions_scope.ts";
export { GhApiSettings } from "./src/api_command.ts";
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
