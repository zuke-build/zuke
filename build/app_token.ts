// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one mint for every GitHub App installation token the build uses.
 *
 * Three targets mint one — the website sync, the action release, and the
 * on-demand review — and each differed only in the permissions it asked for
 * and the repository it named. The mint itself, and the credentials it starts
 * from, are one thing, so they live here once: a caller states its scope and
 * gets a token, and the refusal to mint for a repository the caller did not
 * mean stays the caller's, since only it knows which repository that is.
 *
 * @module
 */

import {
  type GhAppTokenResult,
  type GhAppTokenSettings,
  type GhPermissionLevel,
  GhTasks,
} from "@zuke/gh";

/** The credentials of the `zuke-build` GitHub App, as the workflows pass them. */
export interface AppCredentials {
  /** The app's id (`ZUKE_BUILD_APP_ID`). */
  appId: string;
  /** The app's PEM private key (`ZUKE_BUILD_APP_KEY`). */
  privateKey: string;
}

/**
 * The app credentials in `env`, or `null` when either half is missing — absent
 * locally and on fork PRs, where a target that needs them skips rather than
 * fails.
 */
export function resolveAppCredentials(
  env: { appId?: string; privateKey?: string },
): AppCredentials | null {
  const { appId, privateKey } = env;
  if (appId === undefined || appId === "") return null;
  if (privateKey === undefined || privateKey === "") return null;
  return { appId, privateKey };
}

/** The shape of `GhTasks.appToken` — the seam a test replaces. */
export type AppTokenMint = (
  configure: (s: GhAppTokenSettings) => GhAppTokenSettings,
) => Promise<GhAppTokenResult>;

/**
 * Mint an installation token for `repo` (`owner/name`) narrowed to exactly
 * `permissions`. The narrowing is the point: a token holds what its caller
 * performs and nothing more, which is what keeps the review's token unable to
 * tag or push and the sync's unable to touch a workflow file.
 */
export async function mintAppToken(
  credentials: AppCredentials,
  repo: string,
  permissions: Readonly<Record<string, GhPermissionLevel>>,
  appToken: AppTokenMint = GhTasks.appToken,
): Promise<string> {
  // The shape is checked here because the settings cannot: they validate each
  // segment's characters, but a slug with no name would leave the repository
  // unset, and an unset repository means the app's org-level installation —
  // a token for every repository the app is installed on, not one.
  const parts = repo.split("/");
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new Error(
      `cannot mint an app token for ${JSON.stringify(repo)}: expected ` +
        `"owner/name".`,
    );
  }
  const [owner, name] = parts;
  const { token } = await appToken((s) => {
    s.appId(credentials.appId).privateKey(credentials.privateKey)
      .owner(owner).repositories(name);
    for (const [permission, level] of Object.entries(permissions)) {
      s.permission(permission, level);
    }
    return s;
  });
  return token;
}
