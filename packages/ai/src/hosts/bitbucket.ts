/**
 * Post the review as a Bitbucket Cloud pull-request comment. Runs against
 * `/2.0` and upserts a single per-reviewer comment matched by a hidden marker.
 *
 * Bitbucket Pipelines doesn't expose an API token by default — set
 * `BITBUCKET_TOKEN` (an app password or workspace token) or pass
 * `.commentToken(myToken)`.
 *
 * @module
 */

import { AiReviewError } from "../errors.ts";
import { dig } from "../json.ts";
import {
  commentBody,
  commentMarker,
  type EnvReader,
  MAX_COMMENT_PAGES,
  type ReviewHost,
} from "./types.ts";

/** The Bitbucket Cloud REST API origin. */
const API = "https://api.bitbucket.org/2.0";

/** Everything needed to comment on a Bitbucket PR. */
export interface BitbucketContext {
  /** A token with PR write scope (app password or workspace token). */
  token: string;
  /** Workspace slug (`BITBUCKET_WORKSPACE`). */
  workspace: string;
  /** Repository slug (`BITBUCKET_REPO_SLUG`). */
  repoSlug: string;
  /** Pull-request id (`BITBUCKET_PR_ID`). */
  prId: string;
}

/** Resolve the Bitbucket context from the ambient environment and a token. */
export function resolveBitbucketContext(
  token: string,
  env: EnvReader,
): BitbucketContext | undefined {
  if (token === "") return undefined;
  const workspace = env("BITBUCKET_WORKSPACE");
  const repoSlug = env("BITBUCKET_REPO_SLUG");
  const prId = env("BITBUCKET_PR_ID");
  if (workspace === undefined || workspace === "") return undefined;
  if (repoSlug === undefined || repoSlug === "") return undefined;
  if (prId === undefined || prId === "") return undefined;
  return { token, workspace, repoSlug, prId };
}

/** Headers for a Bitbucket REST call. */
function headers(token: string): Record<string, string> {
  return {
    "authorization": `Bearer ${token}`,
    "accept": "application/json",
    "content-type": "application/json",
    "user-agent": "zuke-ai",
  };
}

/** Throw an {@link AiReviewError} for a non-2xx Bitbucket response. */
async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiReviewError(`Bitbucket API error: HTTP ${response.status}`);
  }
}

/** The id of an existing comment carrying `marker`, or `undefined`. */
async function findComment(
  context: BitbucketContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  let url: string | undefined =
    `${API}/repositories/${context.workspace}/${context.repoSlug}` +
    `/pullrequests/${context.prId}/comments?pagelen=100`;
  // Bitbucket paginates via a `next` URL in the body; follow it so a marker
  // beyond the first page is found instead of a duplicate comment posted.
  for (let page = 0; url !== undefined && page < MAX_COMMENT_PAGES; page++) {
    const response = await doFetch(url, { headers: headers(context.token) });
    await ensureOk(response);
    const data: unknown = await response.json();
    const values = dig(data, "values");
    if (Array.isArray(values)) {
      for (const item of values) {
        const raw = dig(item, "content", "raw");
        const id = dig(item, "id");
        if (
          typeof raw === "string" && raw.includes(marker) &&
          typeof id === "number"
        ) {
          return id;
        }
      }
    }
    const next = dig(data, "next");
    url = typeof next === "string" ? next : undefined;
  }
  return undefined;
}

/** Upsert the per-reviewer comment on a Bitbucket PR. */
export async function upsertBitbucketComment(
  context: BitbucketContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const marker = commentMarker(name);
  const raw = commentBody(name, markdown);
  const root = `${API}/repositories/${context.workspace}/${context.repoSlug}` +
    `/pullrequests/${context.prId}/comments`;
  const existing = await findComment(context, marker, doFetch);
  const url = existing === undefined ? root : `${root}/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PUT",
    headers: headers(context.token),
    body: JSON.stringify({ content: { raw } }),
  });
  await ensureOk(response);
}

/** The Bitbucket Cloud Pipelines implementation of {@link ReviewHost}. */
export const bitbucketHost: ReviewHost = {
  label: "Bitbucket",
  defaultTokenEnv: "BITBUCKET_TOKEN",
  prepare(token, env) {
    const context = resolveBitbucketContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch) =>
      upsertBitbucketComment(context, name, markdown, doFetch);
  },
};
