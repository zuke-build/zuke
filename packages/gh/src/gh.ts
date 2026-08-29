// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GhTasks` — a typed wrapper for the `gh` GitHub CLI, in the same
 * settings-lambda style as the other Zuke tool wrappers.
 *
 * `gh` spans many command groups (`pr`, `release`, `issue`, `repo`, `workflow`,
 * `api`, …), so the wrapper is a flexible command builder rather than a
 * per-command API: name the command with `.command(...)`, set the common
 * `--repo` flag, and pass anything else with `.flag(...)` or the `.args(...)`
 * escape hatch.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.run((s) =>
 *   s.command("release", "create", "v1.2.3")
 *     .repo("acme/app").flag("title", "v1.2.3").flag("generate-notes")
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import { GhSettings } from "./settings.ts";
import type { CommandOutput } from "@zuke/core/shell";
import {
  type GhAppTokenApi,
  type GhAppTokenResult,
  type GhAppTokenSettings,
  mintAppToken,
} from "./app_token.ts";
import {
  type GhCheckRunApi,
  type GhCheckRunResult,
  type GhCheckRunSettings,
  postCheckRun,
} from "./check_run.ts";
import {
  commitFiles,
  type GhCommitApi,
  type GhCommitResult,
  type GhCommitSettings,
  type GhTagSettings,
  tagCommit,
} from "./commit.ts";
import {
  findPullRequest,
  type GhPullRequestApi,
  type GhPullRequestResult,
  type GhPullRequestSettings,
  openPullRequest,
} from "./pull_request.ts";
import {
  type GhSarifApi,
  type GhSarifSettings,
  type GhSarifUploadResult,
  uploadSarifReport,
} from "./sarif.ts";
import {
  type GhReleaseAssetApi,
  type GhReleaseAssetResult,
  type GhReleaseAssetSettings,
  uploadReleaseAsset,
} from "./release_asset.ts";
import {
  type GhReleaseLatestApi,
  type GhReleaseLatestResult,
  type GhReleaseLatestSettings,
  markReleaseLatest,
} from "./release_latest.ts";
import { callApi, type GhApiSettings } from "./api_command.ts";
export { GhSettings };
import {
  ghGroupTasks,
  type GhIssueApi,
  type GhPrApi,
  type GhReleaseApi,
} from "./groups.ts";
import {
  ghActionsTasks,
  type GhCacheApi,
  type GhRunApi,
  type GhSecretApi,
  type GhVariableApi,
  type GhWorkflowApi,
} from "./actions_tasks.ts";
import { type GhLabelApi, type GhRepoApi, ghRepoTasks } from "./repo_tasks.ts";

/**
 * The shape of {@link GhTasks}: the `gh` CLI plus the GitHub operations that
 * have no CLI subcommand (see {@link GhAppTokenApi}, {@link GhSarifApi}) and
 * would otherwise force a build back to a marketplace action.
 */
export interface GhTasksApi
  extends
    GhAppTokenApi,
    GhSarifApi,
    GhReleaseAssetApi,
    GhReleaseLatestApi,
    GhCommitApi,
    GhPullRequestApi,
    GhCheckRunApi,
    GhPrApi,
    GhIssueApi,
    GhReleaseApi,
    GhRunApi,
    GhWorkflowApi,
    GhSecretApi,
    GhVariableApi,
    GhCacheApi,
    GhRepoApi,
    GhLabelApi {
  /** Run a `gh` command. */
  run(configure?: Configure<GhSettings>): Promise<CommandOutput>;
  /**
   * Call a REST endpoint through `gh api`, with the user's `gh` credentials —
   * for operations that have no CLI verb, e.g. starring a repository:
   * `GhTasks.api("user/starred/zuke-build/zuke", (s) => s.method("PUT"))`.
   */
  api(
    endpoint: string,
    configure?: Configure<GhApiSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for GitHub: the `gh` CLI and the REST-only operations. */
export const GhTasks: GhTasksApi = {
  ...ghGroupTasks,
  ...ghActionsTasks,
  ...ghRepoTasks,
  run(configure?: Configure<GhSettings>): Promise<CommandOutput> {
    return runSettings(new GhSettings(), configure);
  },
  api(
    endpoint: string,
    configure?: Configure<GhApiSettings>,
  ): Promise<CommandOutput> {
    return callApi(endpoint, configure);
  },
  commit(
    configure?: (s: GhCommitSettings) => GhCommitSettings,
  ): Promise<GhCommitResult> {
    return commitFiles(configure);
  },
  tag(configure?: (s: GhTagSettings) => GhTagSettings): Promise<void> {
    return tagCommit(configure);
  },
  pullRequest(
    configure?: (s: GhPullRequestSettings) => GhPullRequestSettings,
  ): Promise<GhPullRequestResult> {
    return openPullRequest(configure);
  },
  findPullRequest(
    configure?: (s: GhPullRequestSettings) => GhPullRequestSettings,
  ): Promise<GhPullRequestResult | undefined> {
    return findPullRequest(configure);
  },
  checkRun(
    configure?: (s: GhCheckRunSettings) => GhCheckRunSettings,
  ): Promise<GhCheckRunResult> {
    return postCheckRun(configure);
  },
  appToken(
    configure?: Configure<GhAppTokenSettings>,
  ): Promise<GhAppTokenResult> {
    return mintAppToken(configure);
  },
  uploadSarif(
    configure?: Configure<GhSarifSettings>,
  ): Promise<GhSarifUploadResult> {
    return uploadSarifReport(configure);
  },
  uploadReleaseAsset(
    configure?: Configure<GhReleaseAssetSettings>,
  ): Promise<GhReleaseAssetResult> {
    return uploadReleaseAsset(configure);
  },
  markReleaseLatest(
    configure?: Configure<GhReleaseLatestSettings>,
  ): Promise<GhReleaseLatestResult> {
    return markReleaseLatest(configure);
  },
};
