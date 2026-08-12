/**
 * Post the review as an Azure Pipelines pull-request comment thread. Runs
 * against Azure DevOps REST `7.1`; upserts a single per-reviewer **thread**
 * (matched by a hidden marker on its first comment) so re-runs update in place.
 *
 * `SYSTEM_ACCESSTOKEN` isn't exposed to jobs by default — opt in with
 * `persistCredentials: true` on the checkout, or map `System.AccessToken` into
 * the env via `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`.
 *
 * The discussion feature also lists those threads. Azure DevOps reports no
 * repository-relationship field on a comment, so trusted authors must be named
 * explicitly with `.discussion((d) => d.trustAuthors(...))` on this host.
 *
 * @module
 */

import { dig } from "../json.ts";
import {
  commentBody,
  commentMarker,
  type CommentMode,
  ensureOk,
  type EnvReader,
  findOwn,
  type HostComment,
  jsonHeaders,
  type ReviewHost,
} from "./types.ts";

/** Everything needed to comment on an Azure DevOps PR. */
export interface AzureContext {
  /** A bearer token — typically `System.AccessToken` (`SYSTEM_ACCESSTOKEN`). */
  token: string;
  /** Collection root, e.g. `https://dev.azure.com/{org}/`. */
  collection: string;
  /** Team project name (`SYSTEM_TEAMPROJECT`). */
  project: string;
  /** Repository id (`BUILD_REPOSITORY_ID`). */
  repositoryId: string;
  /** Pull-request id (`SYSTEM_PULLREQUEST_PULLREQUESTID`). */
  pullRequestId: string;
}

/** Resolve the Azure context from the ambient environment and a token. */
export function resolveAzureContext(
  token: string,
  env: EnvReader,
): AzureContext | undefined {
  if (token === "") return undefined;
  const collection = env("SYSTEM_COLLECTIONURI");
  const project = env("SYSTEM_TEAMPROJECT");
  const repositoryId = env("BUILD_REPOSITORY_ID");
  const pullRequestId = env("SYSTEM_PULLREQUEST_PULLREQUESTID");
  if (collection === undefined || collection === "") return undefined;
  if (project === undefined || project === "") return undefined;
  if (repositoryId === undefined || repositoryId === "") return undefined;
  if (pullRequestId === undefined || pullRequestId === "") return undefined;
  return {
    token,
    collection: collection.replace(/\/+$/, "") + "/",
    project,
    repositoryId,
    pullRequestId,
  };
}

/** The root URL for a PR's threads. */
function threadsUrl(context: AzureContext): string {
  return `${context.collection}${encodeURIComponent(context.project)}` +
    `/_apis/git/repositories/${context.repositoryId}` +
    `/pullRequests/${context.pullRequestId}/threads`;
}

/**
 * The id of the identity the `token` authenticates as (`GET
 * _apis/connectionData`), or `undefined` when the call fails. Under a pipeline
 * this is the Build Service account, which Azure DevOps does not otherwise flag
 * as a service identity on a comment — so this is how the reviewer recognises
 * the threads it wrote itself.
 */
async function selfIdentity(
  context: AzureContext,
  doFetch: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await doFetch(
      `${context.collection}_apis/connectionData?api-version=7.1`,
      { headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const id = dig(await response.json(), "authenticatedUser", "id");
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `commentType` values that mark an Azure-generated comment: the enum's
 * name as the REST API serialises it, and its ordinal (`CommentType.system`).
 */
const SYSTEM_COMMENT_TYPES: ReadonlySet<unknown> = new Set(["system", 3]);

/** One PR comment plus the id of the thread that holds it. */
interface ThreadComment {
  /** The id of the enclosing thread — needed to address the comment for a PATCH. */
  threadId: number;
  /** The comment in the host-neutral shape. */
  comment: HostComment;
}

/**
 * Every comment on every thread of the pull request, in thread order. `self`
 * (the identity id the token authenticates as, when known) is folded into
 * {@link HostComment.bot} alongside Azure's own `"system"` comment type.
 *
 * `association` is always empty: Azure DevOps reports no repository-relationship
 * field on a comment, and resolving team membership needs a separate Graph API
 * (a different host, different scopes) — so on Azure the discussion's only trust
 * path is `.discussion((d) => d.trustAuthors(...))`, matched against the
 * author's `uniqueName` (the sign-in address). This is documented in
 * `docs/ai-review.md`.
 */
async function fetchThreadComments(
  context: AzureContext,
  doFetch: typeof fetch,
  self?: string,
): Promise<ThreadComment[]> {
  // No pagination loop (unlike the GitHub/GitLab/Bitbucket hosts): the Azure
  // DevOps PR *threads* list endpoint returns every thread for the PR in one
  // response — it exposes no `$top`/`$skip` and no continuation-token header — so
  // a single fetch is complete and the marker can't hide on a later page.
  const url = `${threadsUrl(context)}?api-version=7.1`;
  const response = await doFetch(url, {
    headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
  });
  await ensureOk(response, "Azure DevOps");
  const data: unknown = await response.json();
  const values = dig(data, "value");
  const found: ThreadComment[] = [];
  if (!Array.isArray(values)) return found;
  for (const thread of values) {
    const threadId = dig(thread, "id");
    const comments = dig(thread, "comments");
    if (typeof threadId !== "number" || !Array.isArray(comments)) continue;
    for (const comment of comments) {
      const content = dig(comment, "content");
      const commentId = dig(comment, "id");
      if (typeof content !== "string" || typeof commentId !== "number") {
        continue;
      }
      const unique = dig(comment, "author", "uniqueName");
      const display = dig(comment, "author", "displayName");
      const authorId = dig(comment, "author", "id");
      const label = typeof display === "string" ? display : undefined;
      found.push({
        threadId,
        comment: {
          id: commentId,
          body: content,
          // `uniqueName` (the sign-in address) is the identity an operator can
          // reasonably write in `.trustAuthors(...)`; `displayName` is
          // self-assigned and never used as one. When Azure omits the
          // uniqueName the identity falls back to the descriptor `id` — still
          // stable — rather than to the display name.
          author: typeof unique === "string"
            ? unique
            : typeof authorId === "string"
            ? authorId
            : "",
          ...(label !== undefined ? { displayName: label } : {}),
          association: "",
          // `commentType` comes back as the enum's name on the REST API and as
          // its ordinal (system = 3) on some older/serialised responses.
          bot: SYSTEM_COMMENT_TYPES.has(dig(comment, "commentType")) ||
            (self !== undefined && self !== "" && authorId === self),
        },
      });
    }
  }
  return found;
}

/**
 * List every comment on the pull request's threads, with the trust metadata the
 * discussion feature consumes — resolved from the Azure DevOps API, never from
 * the comment text. See {@link fetchThreadComments} for why `association` is
 * always empty on this host.
 */
export async function listPullRequestComments(
  context: AzureContext,
  doFetch: typeof fetch = fetch,
): Promise<HostComment[]> {
  const self = await selfIdentity(context, doFetch);
  const found = await fetchThreadComments(context, doFetch, self);
  return found.map((entry) => entry.comment);
}

/**
 * The reviewer's own thread: the thread id plus the id of its marker-bearing
 * comment, or `undefined`. Authorship follows the shared {@link findOwn} rule,
 * so a comment that merely quotes the marker — or a human's forgery — is never
 * adopted and never PATCHed over.
 */
async function findThread(
  context: AzureContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<{ threadId: number; commentId: number } | undefined> {
  const self = await selfIdentity(context, doFetch);
  const found = await fetchThreadComments(context, doFetch, self);
  const own = await findOwn(found.map((entry) => entry.comment), marker);
  if (own === undefined) return undefined;
  const entry = found.find((candidate) => candidate.comment === own);
  return entry === undefined
    ? undefined
    : { threadId: entry.threadId, commentId: own.id };
}

/**
 * Post the per-reviewer comment thread on an Azure DevOps PR — patched in
 * place, or a new thread per run in `"append"` mode (history kept).
 */
export async function upsertPullRequestThread(
  context: AzureContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
  mode: CommentMode = "update",
): Promise<void> {
  const marker = commentMarker(name);
  const content = commentBody(name, markdown);
  const existing = mode === "append"
    ? undefined
    : await findThread(context, marker, doFetch);
  if (existing === undefined) {
    const response = await doFetch(`${threadsUrl(context)}?api-version=7.1`, {
      method: "POST",
      headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
      body: JSON.stringify({
        comments: [{ parentCommentId: 0, content, commentType: 1 }],
        status: 4, // "closed" — informational thread, not a review blocker.
      }),
    });
    await ensureOk(response, "Azure DevOps");
    return;
  }
  const url = `${threadsUrl(context)}/${existing.threadId}` +
    `/comments/${existing.commentId}?api-version=7.1`;
  const response = await doFetch(url, {
    method: "PATCH",
    headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
    body: JSON.stringify({ content, commentType: 1 }),
  });
  await ensureOk(response, "Azure DevOps");
}

/** The Azure Pipelines implementation of {@link ReviewHost}. */
export const azureHost: ReviewHost = {
  label: "Azure Pipelines",
  defaultTokenEnv: "SYSTEM_ACCESSTOKEN",
  prepare(token, env) {
    const context = resolveAzureContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch, mode) =>
      upsertPullRequestThread(context, name, markdown, doFetch, mode);
  },
  listComments(token, env) {
    const context = resolveAzureContext(token, env);
    if (context === undefined) return undefined;
    return (doFetch) => listPullRequestComments(context, doFetch);
  },
};
