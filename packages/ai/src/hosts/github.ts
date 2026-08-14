// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Post the review as a GitHub pull-request comment. Runs against the REST API
 * with `pull-requests: write` and upserts a single per-reviewer comment
 * (matched by a hidden marker) so re-runs update in place.
 *
 * @module
 */

import { dig } from "../json.ts";
import { githubReviewThreads } from "./github_threads.ts";
import {
  commentBody,
  commentMarker,
  type CommentMode,
  ensureOk,
  type EnvReader,
  findOwn,
  type HostComment,
  paginateLinked,
  probeString,
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

/** Map one GitHub comment API item into the host-neutral {@link HostComment}. */
function toHostComment(item: unknown): HostComment | undefined {
  const id = dig(item, "id");
  const body = dig(item, "body");
  if (typeof id !== "number" || typeof body !== "string") return undefined;
  const login = dig(item, "user", "login");
  const type = dig(item, "user", "type");
  const association = dig(item, "author_association");
  return {
    id,
    body,
    author: typeof login === "string" ? login : "",
    association: typeof association === "string" ? association : "",
    bot: type === "Bot",
  };
}

/**
 * List every comment on the pull request, following `Link` pagination (see
 * {@link paginateLinked}). The author login, `author_association`, and bot flag
 * come from the API's own metadata, so the discussion layer's trust decisions
 * are grounded in what GitHub asserts — never in the comment text.
 */
export async function listPrComments(
  context: GithubContext,
  doFetch: typeof fetch = fetch,
): Promise<HostComment[]> {
  const comments: HostComment[] = [];
  const url =
    `${API}/repos/${context.owner}/${context.repo}/issues/${context.pull}/comments?per_page=100`;
  await paginateLinked(
    url,
    githubHeaders(context.token),
    "GitHub",
    doFetch,
    (item) => {
      const comment = toHostComment(item);
      if (comment !== undefined) comments.push(comment);
    },
  );
  return comments;
}

/**
 * The login the `token` authenticates as (`GET /user`), or `undefined` when the
 * endpoint is unavailable — an Actions installation token cannot call it, but
 * its comments are authored by a bot account, which the caller checks first.
 */
export function selfLogin(
  token: string,
  doFetch: typeof fetch,
): Promise<string | undefined> {
  return probeString(`${API}/user`, githubHeaders(token), doFetch, "login");
}

/**
 * The id of the reviewer's own prior comment carrying `marker`, or `undefined`.
 * The authorship rule is the shared {@link findOwn} one: marker at the start of
 * the body **and** a bot author (the Actions token's comments) or the login the
 * token authenticates as (a PAT run) — resolved only when needed.
 */
async function findOwnComment(
  context: GithubContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  const own = await findOwn(
    await listPrComments(context, doFetch),
    marker,
    () => selfLogin(context.token, doFetch),
  );
  return own?.id;
}

/**
 * Post the per-reviewer comment on the pull request. In `"update"` mode
 * (default), patch the existing comment if present — matched by the hidden
 * `name` marker **and** verified as the reviewer's own, see
 * {@link findOwnComment} — otherwise create it. In `"append"` mode, always
 * create a new comment, leaving earlier assessments on the thread as history.
 */
export async function upsertPrComment(
  context: GithubContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
  mode: CommentMode = "update",
): Promise<void> {
  const marker = commentMarker(name);
  const body = commentBody(name, markdown);
  const repo = `${API}/repos/${context.owner}/${context.repo}`;
  const existing = mode === "append"
    ? undefined
    : await findOwnComment(context, marker, doFetch);
  const url = existing === undefined
    ? `${repo}/issues/${context.pull}/comments`
    : `${repo}/issues/comments/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PATCH",
    headers: githubHeaders(context.token),
    body: JSON.stringify({ body }),
  });
  await ensureOk(response, "GitHub");
}

/** The GitHub Actions implementation of {@link ReviewHost}. */
export const githubHost: ReviewHost = {
  label: "GitHub",
  defaultTokenEnv: "GITHUB_TOKEN",
  prepare(token, env) {
    const context = resolveGithubContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch, mode) =>
      upsertPrComment(context, name, markdown, doFetch, mode);
  },
  listComments(token, env) {
    const context = resolveGithubContext(token, env);
    if (context === undefined) return undefined;
    return (doFetch) => listPrComments(context, doFetch);
  },
  reviewThreads(token, env) {
    const context = resolveGithubContext(token, env);
    if (context === undefined) return undefined;
    return githubReviewThreads(context);
  },
};
