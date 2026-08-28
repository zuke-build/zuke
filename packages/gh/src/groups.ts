// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `GhTasks` members for the typed `gh` command groups, and their
 * implementations.
 *
 * The package composes {@link "./gh.ts".GhTasksApi} from one interface per
 * concern, so the CLI groups follow that shape rather than growing one flat
 * interface: {@link GhPrApi}, {@link GhIssueApi}, {@link GhReleaseApi}, and
 * {@link ghGroupTasks} implementing all three.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  GhPrChecksSettings,
  GhPrCloseSettings,
  GhPrCommentSettings,
  GhPrCreateSettings,
  GhPrEditSettings,
  GhPrListSettings,
  GhPrMergeSettings,
  GhPrViewSettings,
  type GhPullRequestEntry,
  readPullRequests,
} from "./pr.ts";
import {
  GhIssueCloseSettings,
  GhIssueCommentSettings,
  GhIssueCreateSettings,
  type GhIssueEntry,
  GhIssueListSettings,
  GhIssueViewSettings,
  readIssues,
} from "./issue.ts";
import {
  GhReleaseCreateSettings,
  GhReleaseDeleteSettings,
  GhReleaseDownloadSettings,
  GhReleaseEditSettings,
  type GhReleaseEntry,
  GhReleaseListSettings,
  GhReleaseUploadSettings,
  GhReleaseViewSettings,
  readReleases,
} from "./release.ts";

/** The `gh pr` members of {@link "./gh.ts".GhTasks}. */
export interface GhPrApi {
  /**
   * Open a pull request: `gh pr create`. Needs the `gh` binary and its auth;
   * {@link "./pull_request.ts".GhPullRequestApi.pullRequest} is the REST path,
   * which needs a token instead.
   */
  prCreate(configure?: Configure<GhPrCreateSettings>): Promise<CommandOutput>;
  /** List pull requests: `gh pr list`. */
  prList(configure?: Configure<GhPrListSettings>): Promise<CommandOutput>;
  /**
   * The pull requests as parsed {@link GhPullRequestEntry} values. The
   * `--json` field set is pinned, since gh requires one by name.
   */
  prListEntries(
    configure?: Configure<GhPrListSettings>,
  ): Promise<GhPullRequestEntry[]>;
  /** Show a pull request: `gh pr view`. */
  prView(configure?: Configure<GhPrViewSettings>): Promise<CommandOutput>;
  /** Report a pull request's checks: `gh pr checks`. */
  prChecks(configure?: Configure<GhPrChecksSettings>): Promise<CommandOutput>;
  /** Merge a pull request: `gh pr merge`. */
  prMerge(configure?: Configure<GhPrMergeSettings>): Promise<CommandOutput>;
  /** Comment on a pull request: `gh pr comment`. */
  prComment(configure?: Configure<GhPrCommentSettings>): Promise<CommandOutput>;
  /** Change a pull request's metadata: `gh pr edit`. */
  prEdit(configure?: Configure<GhPrEditSettings>): Promise<CommandOutput>;
  /** Close a pull request: `gh pr close`. */
  prClose(configure?: Configure<GhPrCloseSettings>): Promise<CommandOutput>;
}

/** The `gh issue` members of {@link "./gh.ts".GhTasks}. */
export interface GhIssueApi {
  /** Open an issue: `gh issue create`. */
  issueCreate(
    configure?: Configure<GhIssueCreateSettings>,
  ): Promise<CommandOutput>;
  /** List issues: `gh issue list`. */
  issueList(configure?: Configure<GhIssueListSettings>): Promise<CommandOutput>;
  /**
   * The issues as parsed {@link GhIssueEntry} values. The `--json` field set
   * is pinned, since gh requires one by name.
   */
  issueListEntries(
    configure?: Configure<GhIssueListSettings>,
  ): Promise<GhIssueEntry[]>;
  /** Show an issue: `gh issue view`. */
  issueView(configure?: Configure<GhIssueViewSettings>): Promise<CommandOutput>;
  /** Comment on an issue: `gh issue comment`. */
  issueComment(
    configure?: Configure<GhIssueCommentSettings>,
  ): Promise<CommandOutput>;
  /** Close an issue: `gh issue close`. */
  issueClose(
    configure?: Configure<GhIssueCloseSettings>,
  ): Promise<CommandOutput>;
}

/** The `gh release` members of {@link "./gh.ts".GhTasks}. */
export interface GhReleaseApi {
  /** Publish a release: `gh release create`. */
  releaseCreate(
    configure?: Configure<GhReleaseCreateSettings>,
  ): Promise<CommandOutput>;
  /** List releases: `gh release list`. */
  releaseList(
    configure?: Configure<GhReleaseListSettings>,
  ): Promise<CommandOutput>;
  /**
   * The releases as parsed {@link GhReleaseEntry} values. The `--json` field
   * set is pinned, since gh requires one by name.
   */
  releaseListEntries(
    configure?: Configure<GhReleaseListSettings>,
  ): Promise<GhReleaseEntry[]>;
  /** Show a release: `gh release view`. */
  releaseView(
    configure?: Configure<GhReleaseViewSettings>,
  ): Promise<CommandOutput>;
  /**
   * Attach assets to a release: `gh release upload`. Needs the `gh` binary;
   * {@link "./release_asset.ts".GhReleaseAssetApi.uploadReleaseAsset} is the
   * REST path, which needs a token instead.
   */
  releaseUpload(
    configure?: Configure<GhReleaseUploadSettings>,
  ): Promise<CommandOutput>;
  /** Download a release's assets: `gh release download`. */
  releaseDownload(
    configure?: Configure<GhReleaseDownloadSettings>,
  ): Promise<CommandOutput>;
  /** Change a release: `gh release edit`. */
  releaseEdit(
    configure?: Configure<GhReleaseEditSettings>,
  ): Promise<CommandOutput>;
  /** Remove a release: `gh release delete`. */
  releaseDelete(
    configure?: Configure<GhReleaseDeleteSettings>,
  ): Promise<CommandOutput>;
}

/**
 * The implementations of {@link GhPrApi}, {@link GhIssueApi}, and
 * {@link GhReleaseApi}, spread into {@link "./gh.ts".GhTasks}.
 */
export const ghGroupTasks: GhPrApi & GhIssueApi & GhReleaseApi = {
  prCreate: (c) => runSettings(new GhPrCreateSettings(), c),
  prList: (c) => runSettings(new GhPrListSettings(), c),
  prListEntries: (c) => readPullRequests(c),
  prView: (c) => runSettings(new GhPrViewSettings(), c),
  prChecks: (c) => runSettings(new GhPrChecksSettings(), c),
  prMerge: (c) => runSettings(new GhPrMergeSettings(), c),
  prComment: (c) => runSettings(new GhPrCommentSettings(), c),
  prEdit: (c) => runSettings(new GhPrEditSettings(), c),
  prClose: (c) => runSettings(new GhPrCloseSettings(), c),
  issueCreate: (c) => runSettings(new GhIssueCreateSettings(), c),
  issueList: (c) => runSettings(new GhIssueListSettings(), c),
  issueListEntries: (c) => readIssues(c),
  issueView: (c) => runSettings(new GhIssueViewSettings(), c),
  issueComment: (c) => runSettings(new GhIssueCommentSettings(), c),
  issueClose: (c) => runSettings(new GhIssueCloseSettings(), c),
  releaseCreate: (c) => runSettings(new GhReleaseCreateSettings(), c),
  releaseList: (c) => runSettings(new GhReleaseListSettings(), c),
  releaseListEntries: (c) => readReleases(c),
  releaseView: (c) => runSettings(new GhReleaseViewSettings(), c),
  releaseUpload: (c) => runSettings(new GhReleaseUploadSettings(), c),
  releaseDownload: (c) => runSettings(new GhReleaseDownloadSettings(), c),
  releaseEdit: (c) => runSettings(new GhReleaseEditSettings(), c),
  releaseDelete: (c) => runSettings(new GhReleaseDeleteSettings(), c),
};
