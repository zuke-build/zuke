// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The token release-please cuts the GitHub releases with.
 *
 * Creating a release creates its tag, and GitHub refuses a tag that would
 * change `.github/workflows/*` relative to the default branch unless the token
 * holds `workflows: write`. That happens whenever a workflow change lands on
 * master between a release PR's merge and its release job — a Dependabot
 * actions bump is enough — and `GITHUB_TOKEN` can never be granted
 * `workflows`, so it fails with "Resource not accessible by integration". The
 * app installation token can hold it, so the release step mints one.
 *
 * @module
 */

import { ACTION_SLUG } from "./action_release.ts";
import {
  type AppTokenMint,
  mintAppToken,
  resolveAppCredentials,
} from "./app_token.ts";
import { GhTasks } from "@zuke/gh";

/** What {@link mintReleaseToken} reads from the environment. */
export interface ReleaseTokenEnv {
  /** `ZUKE_BUILD_APP_ID`. */
  appId?: string;
  /** `ZUKE_BUILD_APP_KEY`. */
  privateKey?: string;
  /** `GITHUB_REPOSITORY`, as `owner/name`. */
  repo: string;
}

/**
 * Mint the installation token that creates the GitHub releases, scoped to
 * this repository and to exactly what `release-please github-release` does:
 * the release and its tag (`contents`, plus `workflows` for a tag whose tree
 * differs in workflow files), and the label it moves on the release PR
 * (`pull_requests`).
 */
export async function mintReleaseToken(
  env: ReleaseTokenEnv,
  appToken: AppTokenMint = GhTasks.appToken,
): Promise<string> {
  const credentials = resolveAppCredentials(env);
  if (credentials === null) {
    throw new Error(
      "release needs ZUKE_BUILD_APP_ID and ZUKE_BUILD_APP_KEY to create the " +
        "GitHub releases. GITHUB_TOKEN cannot: it has no `workflows` " +
        "permission, so GitHub refuses any release tag whose tree differs " +
        "from master in `.github/workflows/*`.",
    );
  }
  // Refuse rather than mint for a redirected target: an environment variable
  // must not decide what the app's credential reaches.
  if (env.repo !== ACTION_SLUG) {
    throw new Error(
      `refusing to mint the release token for ${env.repo}: it is scoped to ` +
        `${ACTION_SLUG}.`,
    );
  }
  return await mintAppToken(credentials, env.repo, {
    contents: "write",
    pull_requests: "write",
    workflows: "write",
  }, appToken);
}
