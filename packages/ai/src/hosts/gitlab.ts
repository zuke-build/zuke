/**
 * Post the review as a GitLab merge-request note. Runs against the v4 REST API
 * (`CI_API_V4_URL`) and upserts a single per-reviewer note matched by a hidden
 * marker.
 *
 * GitLab's CI `$CI_JOB_TOKEN` can't create MR notes — you need a personal or
 * group access token with the `api` scope; export it as `GITLAB_TOKEN` (or
 * pass `.commentToken(myToken)`).
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
  MAX_COMMENT_PAGES,
  nextLink,
  type ReviewHost,
} from "./types.ts";

/** The default GitLab API root used when `CI_API_V4_URL` is absent. */
const DEFAULT_API = "https://gitlab.com/api/v4";

/** Everything needed to comment on a merge request. */
export interface GitlabContext {
  /** A token with `api` scope (typically `GITLAB_TOKEN`). */
  token: string;
  /** API base, e.g. `https://gitlab.com/api/v4` — honours `CI_API_V4_URL`. */
  api: string;
  /** Numeric project id (`CI_PROJECT_ID`). */
  projectId: string;
  /** MR IID (project-scoped iid, `CI_MERGE_REQUEST_IID`). */
  mrIid: string;
}

/**
 * Resolve the GitLab context from the ambient environment and a token. Returns
 * `undefined` when any piece is missing — e.g. a pipeline triggered by a push
 * rather than a merge request.
 */
export function resolveGitlabContext(
  token: string,
  env: EnvReader,
): GitlabContext | undefined {
  if (token === "") return undefined;
  const projectId = env("CI_PROJECT_ID");
  const mrIid = env("CI_MERGE_REQUEST_IID");
  if (projectId === undefined || projectId === "") return undefined;
  if (mrIid === undefined || mrIid === "") return undefined;
  const api = env("CI_API_V4_URL") ?? DEFAULT_API;
  return { token, api: api.replace(/\/+$/, ""), projectId, mrIid };
}

/** The id of an existing note carrying `marker`, or `undefined`. */
async function findNote(
  context: GitlabContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  let url: string | undefined = `${context.api}/projects/${context.projectId}` +
    `/merge_requests/${context.mrIid}/notes?per_page=100&sort=desc`;
  // Newest-first, but still follow `Link: rel="next"` so an older marker on a
  // busy MR (>100 notes) is found rather than re-posted as a duplicate.
  for (let page = 0; url !== undefined && page < MAX_COMMENT_PAGES; page++) {
    const response = await doFetch(url, {
      headers: jsonHeaders({ "PRIVATE-TOKEN": context.token }),
    });
    await ensureOk(response, "GitLab");
    const data: unknown = await response.json();
    if (Array.isArray(data)) {
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
    }
    url = nextLink(response.headers.get("link"));
  }
  return undefined;
}

/** Upsert the per-reviewer note: PUT to update, POST to create. */
export async function upsertMergeRequestNote(
  context: GitlabContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const marker = commentMarker(name);
  const body = commentBody(name, markdown);
  const root = `${context.api}/projects/${context.projectId}` +
    `/merge_requests/${context.mrIid}/notes`;
  const existing = await findNote(context, marker, doFetch);
  const url = existing === undefined ? root : `${root}/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PUT",
    headers: jsonHeaders({ "PRIVATE-TOKEN": context.token }),
    body: JSON.stringify({ body }),
  });
  await ensureOk(response, "GitLab");
}

/** The GitLab CI implementation of {@link ReviewHost}. */
export const gitlabHost: ReviewHost = {
  label: "GitLab",
  defaultTokenEnv: "GITLAB_TOKEN",
  prepare(token, env) {
    const context = resolveGitlabContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch) =>
      upsertMergeRequestNote(context, name, markdown, doFetch);
  },
};
