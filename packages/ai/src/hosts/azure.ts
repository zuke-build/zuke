/**
 * Post the review as an Azure Pipelines pull-request comment thread. Runs
 * against Azure DevOps REST `7.1`; upserts a single per-reviewer **thread**
 * (matched by a hidden marker on its first comment) so re-runs update in place.
 *
 * `SYSTEM_ACCESSTOKEN` isn't exposed to jobs by default — opt in with
 * `persistCredentials: true` on the checkout, or map `System.AccessToken` into
 * the env via `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`.
 *
 * @module
 */

import { dig } from "../json.ts";
import {
  commentBody,
  commentMarker,
  ensureOk,
  type EnvReader,
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

/** A matching thread's id + the marker-bearing comment's id, or `undefined`. */
async function findThread(
  context: AzureContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<{ threadId: number; commentId: number } | undefined> {
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
  if (!Array.isArray(values)) return undefined;
  for (const thread of values) {
    const threadId = dig(thread, "id");
    const comments = dig(thread, "comments");
    if (typeof threadId !== "number" || !Array.isArray(comments)) continue;
    for (const comment of comments) {
      const content = dig(comment, "content");
      const commentId = dig(comment, "id");
      if (
        typeof content === "string" && content.includes(marker) &&
        typeof commentId === "number"
      ) {
        return { threadId, commentId };
      }
    }
  }
  return undefined;
}

/** Upsert the per-reviewer comment thread on an Azure DevOps PR. */
export async function upsertPullRequestThread(
  context: AzureContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const marker = commentMarker(name);
  const content = commentBody(name, markdown);
  const existing = await findThread(context, marker, doFetch);
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
    return (name, markdown, doFetch) =>
      upsertPullRequestThread(context, name, markdown, doFetch);
  },
};
