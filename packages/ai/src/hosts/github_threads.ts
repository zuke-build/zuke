// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * GitHub's review-thread operations: the file/line-anchored comment threads a
 * finding is posted into, replied to, and resolved on.
 *
 * Distinct from `./github.ts` (the single summary *issue* comment) and from
 * `./github_review.ts` (the fixer's committable suggestions), though all three
 * speak the same REST dialect. Resolution is the one operation with no REST
 * equivalent: a review comment's node id addresses the *comment*, not the
 * thread, so the thread's node id is joined in via one paged GraphQL query.
 *
 * Every write here is best-effort and total: a rejected anchor skips one
 * finding, a rate limit halts the phase, and resolution failing is survivable
 * by design — the outcome reply is the human-visible record, and the summary
 * comment lists every finding either way.
 *
 * @module
 */

import { dig } from "../json.ts";
import { type GithubContext, githubHeaders, selfLogin } from "./github.ts";
import {
  ensureOk,
  type HostComment,
  MAX_COMMENT_PAGES,
  paginateLinked,
  type ReviewComments,
  type ReviewThreads,
  type ThreadPost,
} from "./types.ts";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/** The GitHub GraphQL endpoint — used only to resolve and unresolve threads. */
const GRAPHQL = "https://api.github.com/graphql";

/**
 * Statuses that end the whole phase rather than one comment: rate limiting,
 * a forbidden token, and server errors. Continuing would hammer an API that
 * has just asked us to stop, and the next run resumes for free because the
 * markers already posted are the ledger.
 */
function isStop(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

/** Classify a write response without letting it throw. */
async function outcomeOf(response: Response): Promise<ThreadPost> {
  if (response.ok) {
    await response.body?.cancel();
    return "created";
  }
  await response.body?.cancel();
  return isStop(response.status) ? "stop" : "rejected";
}

/** Map one review-comment API item into the host-neutral shape. */
function toReviewComment(item: unknown): HostComment | undefined {
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
    kind: "review",
  };
}

/**
 * Every review comment on the pull request, with the reply parentage GitHub
 * reports (`in_reply_to_id`). Paginated like every other listing, so a thread
 * beyond the first page is found rather than duplicated.
 */
export async function listReviewComments(
  context: GithubContext,
  doFetch: typeof fetch = fetch,
): Promise<ReviewComments> {
  const comments: HostComment[] = [];
  const parents = new Map<number, number>();
  const url = `${API}/repos/${context.owner}/${context.repo}` +
    `/pulls/${context.pull}/comments?per_page=100`;
  await paginateLinked(
    url,
    githubHeaders(context.token),
    "GitHub",
    doFetch,
    (item) => {
      const comment = toReviewComment(item);
      if (comment === undefined) return;
      comments.push(comment);
      const parent = dig(item, "in_reply_to_id");
      if (typeof parent === "number") parents.set(comment.id, parent);
    },
  );
  return {
    comments,
    parents,
    resolveSelf: () => selfLogin(context.token, doFetch),
  };
}

/** The pull request's head commit SHA — a new thread must anchor to a commit. */
export async function headSha(
  context: GithubContext,
  doFetch: typeof fetch = fetch,
): Promise<string | undefined> {
  const url =
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}`;
  const response = await doFetch(url, {
    headers: githubHeaders(context.token),
  });
  await ensureOk(response, "GitHub");
  const sha = dig(await response.json(), "head", "sha");
  return typeof sha === "string" ? sha : undefined;
}

/**
 * Open a review thread anchored to `path`:`line` on the right side of `sha`.
 * A line GitHub does not consider part of its own diff is a `422`, which is
 * `"rejected"` — that finding keeps its place in the summary table.
 */
export async function openThread(
  context: GithubContext,
  doFetch: typeof fetch,
  sha: string,
  path: string,
  line: number,
  body: string,
): Promise<ThreadPost> {
  const response = await doFetch(
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}/comments`,
    {
      method: "POST",
      headers: githubHeaders(context.token),
      body: JSON.stringify({
        body,
        commit_id: sha,
        path,
        line,
        side: "RIGHT",
      }),
    },
  );
  return await outcomeOf(response);
}

/** Reply into an existing thread, addressed by its root comment id. */
export async function replyToThread(
  context: GithubContext,
  doFetch: typeof fetch,
  rootId: number,
  body: string,
): Promise<ThreadPost> {
  const response = await doFetch(
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}` +
      `/comments/${rootId}/replies`,
    {
      method: "POST",
      headers: githubHeaders(context.token),
      body: JSON.stringify({ body }),
    },
  );
  return await outcomeOf(response);
}

/** The paged query joining each thread's node id to its root comment's REST id. */
const THREAD_IDS_QUERY =
  `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){ pullRequest(number:$number){
    reviewThreads(first:100, after:$cursor){
      nodes { id comments(first:1){ nodes { databaseId } } }
      pageInfo { hasNextPage endCursor } } } } }`;

/**
 * Post one GraphQL request, returning the `data` payload — or `undefined` on
 * any failure. GraphQL reports errors in a **200** response carrying a
 * non-empty `errors` array, so checking `response.ok` alone would read a
 * failed mutation as a success.
 */
async function graphql(
  context: GithubContext,
  doFetch: typeof fetch,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = await doFetch(GRAPHQL, {
      method: "POST",
      headers: githubHeaders(context.token),
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const payload: unknown = await response.json();
    const errors = dig(payload, "errors");
    if (Array.isArray(errors) && errors.length > 0) return undefined;
    return dig(payload, "data");
  } catch {
    return undefined;
  }
}

/**
 * Thread node id keyed by the REST id of the thread's first comment — the join
 * REST cannot do. A review comment's own node id addresses the comment, and
 * the resolve mutation rejects it.
 */
async function threadNodeIds(
  context: GithubContext,
  doFetch: typeof fetch,
): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const data: unknown = await graphql(context, doFetch, THREAD_IDS_QUERY, {
      owner: context.owner,
      repo: context.repo,
      number: context.pull,
      cursor,
    });
    const threads = dig(data, "repository", "pullRequest", "reviewThreads");
    const nodes = dig(threads, "nodes");
    if (!Array.isArray(nodes)) return ids;
    for (const node of nodes) {
      const nodeId = dig(node, "id");
      const rootId = dig(node, "comments", "nodes", 0, "databaseId");
      if (typeof nodeId === "string" && typeof rootId === "number") {
        ids.set(rootId, nodeId);
      }
    }
    if (dig(threads, "pageInfo", "hasNextPage") !== true) return ids;
    const next = dig(threads, "pageInfo", "endCursor");
    if (typeof next !== "string") return ids;
    cursor = next;
  }
  return ids;
}

/** The resolve and unresolve mutations, keyed by the flag the caller passes. */
const MUTATIONS = {
  resolve:
    `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread { id } } }`,
  unresolve:
    `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread { id } } }`,
};

/**
 * Resolve (or unresolve) each thread, returning how many succeeded. Never
 * throws: resolution is cosmetic next to the outcome reply that precedes it,
 * and a token without the scope for the mutation must not fail a build.
 */
export async function setThreadsResolved(
  context: GithubContext,
  doFetch: typeof fetch,
  rootIds: readonly number[],
  resolved: boolean,
): Promise<number> {
  if (rootIds.length === 0) return 0;
  const nodes = await threadNodeIds(context, doFetch);
  const mutation = resolved ? MUTATIONS.resolve : MUTATIONS.unresolve;
  let done = 0;
  for (const rootId of rootIds) {
    const id = nodes.get(rootId);
    if (id === undefined) continue;
    if (await graphql(context, doFetch, mutation, { id }) !== undefined) done++;
  }
  return done;
}

/** The {@link ReviewThreads} implementation for a resolved GitHub context. */
export function githubReviewThreads(context: GithubContext): ReviewThreads {
  return {
    list: (doFetch) => listReviewComments(context, doFetch),
    headSha: (doFetch) => headSha(context, doFetch),
    open: (doFetch, sha, path, line, body) =>
      openThread(context, doFetch, sha, path, line, body),
    reply: (doFetch, rootId, body) =>
      replyToThread(context, doFetch, rootId, body),
    setResolved: (doFetch, rootIds, resolved) =>
      setThreadsResolved(context, doFetch, rootIds, resolved),
  };
}
