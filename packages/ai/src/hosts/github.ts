/**
 * Post the review as a GitHub pull-request comment. Runs against the REST API
 * with `pull-requests: write` and upserts a single per-reviewer comment
 * (matched by a hidden marker) so re-runs update in place.
 *
 * @module
 */

import { AiReviewError } from "../errors.ts";
import { dig } from "../json.ts";
import {
  commentBody,
  commentMarker,
  type EnvReader,
  readEnv,
  type ReviewHost,
} from "./types.ts";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/** Everything needed to comment on a pull request. */
export interface GithubContext {
  /** A token with `pull-requests: write` (the Actions `GITHUB_TOKEN`). */
  token: string;
  /** The repository owner (`owner` in `owner/repo`). */
  owner: string;
  /** The repository name (`repo` in `owner/repo`). */
  repo: string;
  /** The pull-request number to comment on. */
  pull: number;
}

/** Parse a `refs/pull/<n>/merge` ref into its pull-request number. */
function pullFromRef(ref: string | undefined): number | undefined {
  const match = (ref ?? "").match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Resolve the GitHub context from the ambient environment and a token. Returns
 * `undefined` when any piece is missing — commenting is best-effort, so a local
 * run without a PR simply skips it.
 */
export function resolveGithubContext(
  token: string,
  env: EnvReader = readEnv,
): GithubContext | undefined {
  if (token === "") return undefined;
  const repo = env("GITHUB_REPOSITORY"); // "owner/repo"
  if (repo === undefined) return undefined;
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash === repo.length - 1) return undefined;
  const pull = pullFromRef(env("GITHUB_REF"));
  if (pull === undefined) return undefined;
  return {
    token,
    owner: repo.slice(0, slash),
    repo: repo.slice(slash + 1),
    pull,
  };
}

/** The request headers for a GitHub REST call. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    "authorization": `Bearer ${token}`,
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "zuke-ai",
  };
}

/** Throw an {@link AiReviewError} for a non-2xx GitHub response. */
export async function ensureGithubOk(response: Response): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiReviewError(`GitHub API error: HTTP ${response.status}`);
  }
}

/** The id of an existing comment carrying `marker`, or `undefined`. */
async function findComment(
  context: GithubContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  const url =
    `${API}/repos/${context.owner}/${context.repo}/issues/${context.pull}/comments?per_page=100`;
  const response = await doFetch(url, {
    headers: githubHeaders(context.token),
  });
  await ensureGithubOk(response);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) return undefined;
  for (const item of data) {
    const body = dig(item, "body");
    const id = dig(item, "id");
    if (
      typeof body === "string" && body.includes(marker) &&
      typeof id === "number"
    ) {
      return id;
    }
  }
  return undefined;
}

/**
 * Upsert the per-reviewer comment on the pull request: patch the existing one
 * if present (matched by the hidden `name` marker), otherwise create it.
 */
export async function upsertPrComment(
  context: GithubContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const marker = commentMarker(name);
  const body = commentBody(name, markdown);
  const repo = `${API}/repos/${context.owner}/${context.repo}`;
  const existing = await findComment(context, marker, doFetch);
  const url = existing === undefined
    ? `${repo}/issues/${context.pull}/comments`
    : `${repo}/issues/comments/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PATCH",
    headers: githubHeaders(context.token),
    body: JSON.stringify({ body }),
  });
  await ensureGithubOk(response);
}

/** The GitHub Actions implementation of {@link ReviewHost}. */
export const githubHost: ReviewHost = {
  label: "GitHub",
  defaultTokenEnv: "GITHUB_TOKEN",
  prepare(token, env) {
    const context = resolveGithubContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch) =>
      upsertPrComment(context, name, markdown, doFetch);
  },
};
