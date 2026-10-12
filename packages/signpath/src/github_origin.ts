// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link SignPathGitHubOriginSettings} — a submission whose artifact SignPath
 * fetches from a GitHub Actions workflow run itself, verifying where it came
 * from.
 *
 * This is the route SignPath's open-source programme requires. The build
 * uploads the file with `actions/upload-artifact` (v4 or later) and passes the
 * step's `artifact-id` output here; SignPath's GitHub connector then reads the
 * workflow run through the GitHub token, checks the artifact belongs to it,
 * checks every job leading up to it ran on a GitHub-hosted runner, downloads
 * the artifact and records the repository, branch and commit it was built
 * from. Nothing is uploaded from the build itself.
 *
 * The request mirrors what SignPath's own action,
 * `signpath/github-action-submit-signing-request@v3`, sends:
 * `POST <connector>/<org>/SigningRequests?api-version=1.0` with a JSON body of
 * `artifactId`, `gitHubWorkflowRunId`, `gitHubRepository`, `gitHubToken`,
 * `signPathProjectSlug`, `signPathSigningPolicySlug`,
 * `signPathArtifactConfigurationSlug` and `parameters`, authenticated with the
 * SignPath API token.
 *
 * @module
 */

/** SignPath's hosted GitHub.com connector, the default {@link SignPathGitHubOriginSettings.connectorUrl}. */
export const SIGNPATH_GITHUB_CONNECTOR_URL =
  "https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom";

/**
 * Where the artifact to sign lives in GitHub Actions. Only the artifact id is
 * required: the run, repository and token default to the workflow's own
 * environment (`GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, `GITHUB_TOKEN`).
 *
 * ```ts
 * await SignPathTasks.submit((s) =>
 *   s.projectSlug("zuke").signingPolicySlug("release-signing")
 *     .gitHubOrigin((g) => g.artifactId(artifactId).token(githubToken))
 *     .output("dist/signed/zuke.zip")
 * );
 * ```
 */
export class SignPathGitHubOriginSettings {
  /** The workflow artifact's id (set by {@link artifactId}). */
  artifactId_?: string;
  /** The workflow run's id (set by {@link runId}); else `GITHUB_RUN_ID`. */
  runId_?: string;
  /** The repository, `owner/name` (set by {@link repository}); else `GITHUB_REPOSITORY`. */
  repository_?: string;
  /** The GitHub token (set by {@link token}); else `GITHUB_TOKEN`. */
  token_?: string;
  /** The connector's URL (set by {@link connectorUrl}). */
  connectorUrl_: string = SIGNPATH_GITHUB_CONNECTOR_URL;

  /**
   * The id of the artifact `actions/upload-artifact` (v4 or later) uploaded —
   * its `artifact-id` step output. Required.
   */
  artifactId(id: string | number): this {
    this.artifactId_ = String(id);
    return this;
  }

  /** The workflow run the artifact belongs to; defaults to `GITHUB_RUN_ID`. */
  runId(id: string | number): this {
    this.runId_ = String(id);
    return this;
  }

  /** The repository, `owner/name`; defaults to `GITHUB_REPOSITORY`. */
  repository(name: string): this {
    this.repository_ = name;
    return this;
  }

  /**
   * The GitHub token the connector reads the run and downloads the artifact
   * with — the workflow's `GITHUB_TOKEN` (with `actions: read` and
   * `contents: read`) is enough. Defaults to the `GITHUB_TOKEN` environment
   * variable. It is masked out of every message, like the API token.
   *
   * The workflow's own token stops working when the workflow ends, so the
   * task must wait for SignPath to fetch the artifact; `submit` always waits.
   */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /**
   * The SignPath GitHub connector to submit through; SignPath's hosted
   * GitHub.com one by default. Only a self-hosted GitHub Enterprise Server
   * needs another. It carries the API token, so it must be `https:`.
   */
  connectorUrl(url: string): this {
    this.connectorUrl_ = url;
    return this;
  }
}
