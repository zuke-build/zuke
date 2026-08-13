// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Post the review as a Bitbucket Cloud pull-request comment. Runs against
 * `/2.0` and upserts a single per-reviewer comment matched by a hidden marker.
 *
 * Bitbucket Pipelines doesn't expose an API token by default — set
 * `BITBUCKET_TOKEN` (an app password or workspace token) or pass
 * `.commentToken(myToken)`.
 *
 * The discussion feature lists the same comments. Bitbucket reports no
 * `author_association`, so trust is derived from **workspace permissions** —
 * see {@link associationFor} — and the reviewer identifies its own comments by
 * the account the token authenticates as, which needs an app password.
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

/**
 * GET a paginated Bitbucket collection, following the `next` URL in the body up
 * to {@link MAX_COMMENT_PAGES}, and hand every item in `values` to `onItem`.
 */
async function paginate(
  context: BitbucketContext,
  url: string,
  doFetch: typeof fetch,
  onItem: (item: unknown) => void,
): Promise<void> {
  let next: string | undefined = url;
  for (let page = 0; next !== undefined && page < MAX_COMMENT_PAGES; page++) {
    const response = await doFetch(next, {
      headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
    });
    await ensureOk(response, "Bitbucket");
    const data: unknown = await response.json();
    const values = dig(data, "values");
    if (Array.isArray(values)) { for (const item of values) onItem(item); }
    const link = dig(data, "next");
    next = typeof link === "string" ? link : undefined;
  }
}

/**
 * The account uuid the `token` authenticates as (`GET /2.0/user`), or
 * `undefined` when the call fails. Bitbucket puts no bot/app flag on a comment,
 * so this is the only way the reviewer recognises its own comments — and it
 * only resolves for a token that maps to an account (an app password). A
 * repository or workspace access token is not a user: `/2.0/user` refuses it,
 * the reviewer cannot attribute its own comments, and the discussion state is
 * therefore not carried across runs. Documented in `docs/ai-review.md`.
 */
async function selfUuid(
  context: BitbucketContext,
  doFetch: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await doFetch(`${API}/user`, {
      headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const uuid = dig(await response.json(), "uuid");
    return typeof uuid === "string" ? uuid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every comment on the pull request, oldest first, with `self` (the uuid the
 * token authenticates as, when known) folded into {@link HostComment.bot}.
 * Deleted comments carry no body and are skipped. `association` is left empty —
 * {@link listBitbucketComments} fills it from workspace permissions.
 *
 * The identity is the account **uuid**, and the nickname is carried only as
 * {@link HostComment.displayName}: a nickname is a mutable, non-unique display
 * alias its owner sets, so keying any trust decision on it would let an
 * outsider inherit a maintainer's standing by renaming themselves.
 */
async function fetchComments(
  context: BitbucketContext,
  doFetch: typeof fetch,
  self?: string,
): Promise<HostComment[]> {
  const comments: HostComment[] = [];
  const url = `${API}/repositories/${context.workspace}/${context.repoSlug}` +
    `/pullrequests/${context.prId}/comments?pagelen=100`;
  await paginate(context, url, doFetch, (item) => {
    const id = dig(item, "id");
    const raw = dig(item, "content", "raw");
    if (typeof id !== "number" || typeof raw !== "string") return;
    if (dig(item, "deleted") === true) return;
    const nickname = dig(item, "user", "nickname");
    const display = dig(item, "user", "display_name");
    const uuid = dig(item, "user", "uuid");
    const label = typeof nickname === "string"
      ? nickname
      : typeof display === "string"
      ? display
      : undefined;
    comments.push({
      id,
      body: raw,
      author: typeof uuid === "string" ? uuid : "",
      ...(label !== undefined ? { displayName: label } : {}),
      association: "",
      bot: self !== undefined && self !== "" && uuid === self,
    });
  });
  return comments;
}

/**
 * Workspace permissions as an account-uuid → permission map, or `undefined`
 * when the listing fails (a token without the `account` scope). Failing to
 * `undefined` keeps the trust decision fail-closed: every author then carries
 * an empty association, so only `.trustAuthors(...)` can admit them.
 */
async function workspaceMembers(
  context: BitbucketContext,
  doFetch: typeof fetch,
): Promise<Map<string, string> | undefined> {
  const members = new Map<string, string>();
  const url = `${API}/workspaces/${context.workspace}/permissions?pagelen=100`;
  try {
    await paginate(context, url, doFetch, (item) => {
      const uuid = dig(item, "user", "uuid");
      const permission = dig(item, "permission");
      if (typeof uuid === "string" && typeof permission === "string") {
        members.set(uuid, permission);
      }
    });
  } catch {
    return undefined;
  }
  return members;
}

/**
 * The `association` for a Bitbucket workspace `permission`, in GitHub's
 * vocabulary (the one {@link "../discussion.ts".DEFAULT_TRUSTED_ASSOCIATIONS}
 * speaks): `owner` → `OWNER`, `collaborator` → `COLLABORATOR`, `member` →
 * `MEMBER`, anything else → `NONE`. Bitbucket reports no `author_association`
 * of its own, so workspace permission is the equivalent signal.
 */
function associationFor(permission: string): string {
  switch (permission) {
    case "owner":
      return "OWNER";
    case "collaborator":
      return "COLLABORATOR";
    case "member":
      return "MEMBER";
    default:
      return "NONE";
  }
}

/**
 * List every comment on the pull request with the trust metadata the discussion
 * feature needs — author, bot flag, and association all resolved from
 * Bitbucket's API, never from the comment text.
 */
export async function listBitbucketComments(
  context: BitbucketContext,
  doFetch: typeof fetch = fetch,
): Promise<HostComment[]> {
  const [self, members] = await Promise.all([
    selfUuid(context, doFetch),
    workspaceMembers(context, doFetch),
  ]);
  const comments = await fetchComments(context, doFetch, self);
  if (members === undefined) return comments;
  return comments.map((comment) => {
    const permission = members.get(comment.author);
    return {
      ...comment,
      association: permission === undefined
        ? "NONE"
        : associationFor(permission),
    };
  });
}

/** The id of the reviewer's own comment carrying `marker`, or `undefined`. */
async function findComment(
  context: BitbucketContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  const self = await selfUuid(context, doFetch);
  const own = await findOwn(
    await fetchComments(context, doFetch, self),
    marker,
  );
  return own?.id;
}

/**
 * Post the per-reviewer comment on a Bitbucket PR — PUT in place, or a new
 * comment per run in `"append"` mode (history kept).
 */
export async function upsertBitbucketComment(
  context: BitbucketContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
  mode: CommentMode = "update",
): Promise<void> {
  const marker = commentMarker(name);
  const raw = commentBody(name, markdown);
  const root = `${API}/repositories/${context.workspace}/${context.repoSlug}` +
    `/pullrequests/${context.prId}/comments`;
  const existing = mode === "append"
    ? undefined
    : await findComment(context, marker, doFetch);
  const url = existing === undefined ? root : `${root}/${existing}`;
  const response = await doFetch(url, {
    method: existing === undefined ? "POST" : "PUT",
    headers: jsonHeaders({ "authorization": `Bearer ${context.token}` }),
    body: JSON.stringify({ content: { raw } }),
  });
  await ensureOk(response, "Bitbucket");
}

/** The Bitbucket Cloud Pipelines implementation of {@link ReviewHost}. */
export const bitbucketHost: ReviewHost = {
  label: "Bitbucket",
  defaultTokenEnv: "BITBUCKET_TOKEN",
  prepare(token, env) {
    const context = resolveBitbucketContext(token, env);
    if (context === undefined) return undefined;
    return (name, markdown, doFetch, mode) =>
      upsertBitbucketComment(context, name, markdown, doFetch, mode);
  },
  listComments(token, env) {
    const context = resolveBitbucketContext(token, env);
    if (context === undefined) return undefined;
    return (doFetch) => listBitbucketComments(context, doFetch);
  },
};
