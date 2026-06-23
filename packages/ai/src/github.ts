/**
 * Posting a review to a pull request as a comment. Runs against the GitHub REST
 * API with the workflow token, and upserts a single per-reviewer comment (keyed
 * by a hidden marker) so re-runs update in place instead of piling up.
 *
 * @module
 */

import { AiReviewError } from "./errors.ts";
import { dig } from "./json.ts";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/** Attribution header prepended to every PR comment. */
const HEADER = "🤖 **[Zuke](https://zuke.build) AI review**";

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

/** Read an env var, tolerating an absent `--allow-env` permission. */
export function readEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/** Parse a `refs/pull/<n>/merge` ref into its pull-request number. */
function pullFromRef(ref: string | undefined): number | undefined {
  const match = (ref ?? "").match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Resolve the GitHub context from the ambient environment and a token. Returns
 * `undefined` (rather than throwing) when any piece is missing — commenting is a
 * best-effort side effect, so a local run without a PR simply skips it.
 */
export function resolveGithubContext(
  token: string,
  env: (key: string) => string | undefined = readEnv,
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
function headers(token: string): Record<string, string> {
  return {
    "authorization": `Bearer ${token}`,
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "zuke-ai",
  };
}

/** Throw an {@link AiReviewError} for a non-2xx GitHub response. */
async function ensureOk(response: Response): Promise<void> {
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
  const response = await doFetch(url, { headers: headers(context.token) });
  await ensureOk(response);
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
 * Upsert the per-reviewer comment on the pull request: patch the existing one if
 * present (matched by the hidden `name` marker), otherwise create it. The marker
 * is invisible in rendered Markdown but lets a re-run find its own comment.
 */
export async function upsertPrComment(
  context: GithubContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const marker = `<!-- zuke-ai-review:${name} -->`;
  const body = `${marker}\n${HEADER}\n\n${markdown}`;
  const repo = `${API}/repos/${context.owner}/${context.repo}`;
  const existing = await findComment(context, marker, doFetch);
  const url = existing === undefined
    ? `${repo}/issues/${context.pull}/comments`
    : `${repo}/issues/comments/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PATCH",
    headers: headers(context.token),
    body: JSON.stringify({ body }),
  });
  await ensureOk(response);
}
