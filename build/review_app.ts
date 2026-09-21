// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The AI review's identity on the pull request, and its acknowledgement of the
 * comment that asked for it.
 *
 * The reviewers post with whatever {@link reviewCommentToken} resolves: an
 * installation token of the `zuke-build` GitHub App when the App's credentials
 * are in the environment — both review jobs pass them, so every assessment
 * arrives from `zuke-build[bot]`, the account a maintainer addresses with
 * `@zuke-build review`, and the token can resolve the review threads it
 * answers, which GitHub refuses the workflow's `GITHUB_TOKEN` — and that
 * `GITHUB_TOKEN` otherwise, as a local or credential-less run posts.
 * {@link acknowledgeReviewCommand}
 * reacts 👀 on the command comment before the review runs, the way Dependabot
 * acknowledges its commands, so the maintainer sees the command was picked up
 * without opening the Actions tab.
 *
 * @module
 */

import { ACTION_SLUG } from "./action_release.ts";
import {
  type AppCredentials,
  type AppTokenMint,
  mintAppToken,
  resolveAppCredentials,
} from "./app_token.ts";

/** An environment reader — `Deno.env.get` in the build, a map in tests. */
export type EnvReader = (name: string) => string | undefined;

/** The env var carrying the id of the comment that started an on-demand run. */
export const REVIEW_COMMENT_ENV = "ZUKE_REVIEW_COMMENT";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/**
 * Mint an App installation token narrowed to what the review does: comments
 * and inline review threads (`pull_requests`), the reaction on the command
 * comment (`issues` — a pull request's conversation comments are issue
 * comments), and **resolving** a thread it has answered, which needs
 * `contents: write`. That last one is GitHub's rule, not a preference: the
 * GraphQL mutation that resolves a review thread is allowed to whoever has
 * write access to the repository, and for an installation token that is what
 * `contents: write` means — a token holding `pull_requests: write` alone is
 * refused with "Resource not accessible by integration" while the reply it
 * posted a moment earlier stands (#631). So this token can push and tag; it
 * cannot touch a workflow file or Actions, which are not requested. The
 * narrowing is a courtesy rather than a boundary: the credentials this mints
 * from sit in the same environment, and could mint anything the App holds.
 */
export function mintReviewToken(
  credentials: AppCredentials,
  repo: string,
  appToken?: AppTokenMint,
): Promise<string> {
  return mintAppToken(credentials, repo, {
    pull_requests: "write",
    issues: "write",
    contents: "write",
  }, appToken);
}

/**
 * The comment-posting token for the reviewers, resolved once and shared by all
 * of them. With the App's credentials in `env`, an installation token is
 * minted for {@link ACTION_SLUG} — and only for it: a `GITHUB_REPOSITORY`
 * naming anything else is refused rather than minted for, as the release and
 * the website sync refuse, because an environment variable must not decide
 * what the App's credential reaches. Without the credentials, or when minting
 * fails, the result is `GITHUB_TOKEN` (an empty string off CI, where the
 * reviewers skip commenting): the identity is a courtesy, and losing it must
 * not lose the review.
 */
export function reviewCommentToken(
  env: EnvReader,
  mint: (credentials: AppCredentials, repo: string) => Promise<string> =
    mintReviewToken,
): () => Promise<string> {
  let resolved: Promise<string> | undefined;
  const resolve = async (): Promise<string> => {
    const fallback = env("GITHUB_TOKEN") ?? "";
    const credentials = resolveAppCredentials({
      appId: env("ZUKE_BUILD_APP_ID"),
      privateKey: env("ZUKE_BUILD_APP_KEY"),
    });
    if (credentials === null) return fallback;
    const repo = env("GITHUB_REPOSITORY");
    if (repo !== ACTION_SLUG) {
      console.warn(
        `review: refusing to mint the app token for ${
          repo ?? "no repository"
        }: ` +
          `it is only ever scoped to ${ACTION_SLUG}; posting with GITHUB_TOKEN.`,
      );
      return fallback;
    }
    try {
      return await mint(credentials, repo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `review: could not mint the app token (${message}); posting with ` +
          "GITHUB_TOKEN.",
      );
      return fallback;
    }
  };
  return () => {
    if (resolved === undefined) resolved = resolve();
    return resolved;
  };
}

/**
 * React 👀 on the comment that started this run — the one
 * {@link REVIEW_COMMENT_ENV} names — so the maintainer sees the command was
 * picked up before the assessment lands. Returns whether a reaction was
 * posted: `false` when the run was not comment-started, the id is not a
 * number, no token resolves, or the API refuses — best-effort, like every
 * post the review makes, so it never fails the build.
 */
export async function acknowledgeReviewCommand(
  env: EnvReader,
  token: () => Promise<string>,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  const id = env(REVIEW_COMMENT_ENV);
  const repo = env("GITHUB_REPOSITORY");
  if (id === undefined || !/^[1-9]\d{0,15}$/.test(id) || repo === undefined) {
    return false;
  }
  const bearer = await token();
  if (bearer === "") return false;
  try {
    const response = await doFetch(
      `${API}/repos/${repo}/issues/comments/${id}/reactions`,
      {
        method: "POST",
        headers: {
          "authorization": `Bearer ${bearer}`,
          "accept": "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "zuke-review",
        },
        body: JSON.stringify({ content: "eyes" }),
      },
    );
    await response.body?.cancel();
    if (!response.ok) {
      console.warn(
        `review: could not acknowledge comment ${id}: HTTP ${response.status}`,
      );
    }
    return response.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`review: could not acknowledge comment ${id}: ${message}`);
    return false;
  }
}
