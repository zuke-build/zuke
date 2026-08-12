/**
 * Post the review as a GitLab merge-request note. Runs against the v4 REST API
 * (`CI_API_V4_URL`) and upserts a single per-reviewer note matched by a hidden
 * marker.
 *
 * GitLab's CI `$CI_JOB_TOKEN` can't create MR notes — you need a personal or
 * group access token with the `api` scope; export it as `GITLAB_TOKEN` (or
 * pass `.commentToken(myToken)`).
 *
 * The same token drives the discussion feature: notes are listed with their
 * author metadata, and because GitLab reports no `author_association`, trust is
 * derived from **project membership** (`access_level`) instead — see
 * {@link associationFor}.
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

/**
 * GitLab project access levels, as the members API reports them. Guest (10) and
 * Reporter (20) exist too but cannot push, so they are not mapped to a trusted
 * association.
 */
const DEVELOPER = 30;
/** The access level of a project Owner — mapped to `OWNER`. */
const OWNER = 50;

/**
 * The `association` for a project `access_level`, in GitHub's vocabulary (the
 * one {@link "../discussion.ts".DEFAULT_TRUSTED_ASSOCIATIONS} speaks): Owner
 * (50) → `OWNER`, Developer and Maintainer (30/40) → `MEMBER`, anything lower
 * (Guest, Reporter) → `NONE`. GitLab reports no `author_association` of its
 * own, so membership — which the project controls — is the equivalent signal.
 */
function associationFor(accessLevel: number): string {
  if (accessLevel >= OWNER) return "OWNER";
  if (accessLevel >= DEVELOPER) return "MEMBER";
  return "NONE";
}

/**
 * GET a paginated GitLab collection, following `Link: rel="next"` up to
 * {@link MAX_COMMENT_PAGES}, and hand every item to `onItem`.
 */
async function paginate(
  context: GitlabContext,
  url: string,
  doFetch: typeof fetch,
  onItem: (item: unknown) => void,
): Promise<void> {
  let next: string | undefined = url;
  for (let page = 0; next !== undefined && page < MAX_COMMENT_PAGES; page++) {
    const response = await doFetch(next, {
      headers: jsonHeaders({ "PRIVATE-TOKEN": context.token }),
    });
    await ensureOk(response, "GitLab");
    const data: unknown = await response.json();
    if (Array.isArray(data)) { for (const item of data) onItem(item); }
    next = nextLink(response.headers.get("link"));
  }
}

/**
 * The username the `token` authenticates as (`GET /user`), or `undefined` when
 * the call fails. Both personal and project/group access tokens resolve here —
 * a project access token authenticates as its own `project_<id>_bot<n>` user,
 * whose notes GitLab does not otherwise flag as bot-authored, so this is how
 * the reviewer recognises its own notes on GitLab.
 */
async function selfUsername(
  context: GitlabContext,
  doFetch: typeof fetch,
): Promise<string | undefined> {
  try {
    const response = await doFetch(`${context.api}/user`, {
      headers: jsonHeaders({ "PRIVATE-TOKEN": context.token }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const username = dig(await response.json(), "username");
    return typeof username === "string" ? username : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every note on the merge request, oldest first. `self` (the username the token
 * authenticates as, when known) is folded into {@link HostComment.bot} together
 * with GitLab's own `system` flag and the author's `bot` attribute, so the
 * reviewer's own notes are recognised as its own and are never treated as a
 * maintainer speaking. `association` is left empty here — see
 * {@link listMergeRequestNotes}, which fills it from project membership.
 */
async function fetchNotes(
  context: GitlabContext,
  doFetch: typeof fetch,
  self?: string,
): Promise<HostComment[]> {
  const notes: HostComment[] = [];
  // Oldest-first (GitLab defaults to newest-first) so the reviewer's newest
  // comment is last, as on GitHub; `Link: rel="next"` is followed so a marker
  // on a busy MR (>100 notes) is found rather than re-posted as a duplicate.
  const url = `${context.api}/projects/${context.projectId}` +
    `/merge_requests/${context.mrIid}/notes?per_page=100&sort=asc`;
  await paginate(context, url, doFetch, (item) => {
    const id = dig(item, "id");
    const body = dig(item, "body");
    if (typeof id !== "number" || typeof body !== "string") return;
    const username = dig(item, "author", "username");
    const author = typeof username === "string" ? username : "";
    notes.push({
      id,
      body,
      author,
      association: "",
      bot: dig(item, "system") === true ||
        dig(item, "author", "bot") === true ||
        (self !== undefined && self !== "" && author === self),
    });
  });
  return notes;
}

/**
 * Project membership as a username → access-level map, or `undefined` when the
 * listing fails (a token without `read_api` on the members endpoint). Failing
 * to `undefined` keeps the trust decision fail-closed: every author then
 * carries an empty association, so only `.trustAuthors(...)` can admit them.
 */
async function projectMembers(
  context: GitlabContext,
  doFetch: typeof fetch,
): Promise<Map<string, number> | undefined> {
  const members = new Map<string, number>();
  const url = `${context.api}/projects/${context.projectId}` +
    `/members/all?per_page=100`;
  try {
    await paginate(context, url, doFetch, (item) => {
      const username = dig(item, "username");
      const level = dig(item, "access_level");
      if (typeof username === "string" && typeof level === "number") {
        members.set(username, level);
      }
    });
  } catch {
    return undefined;
  }
  return members;
}

/**
 * List every note on the merge request with the trust metadata the discussion
 * feature needs. The author, the bot flag, and the association all come from
 * GitLab's own API — the note text is never consulted for identity.
 */
export async function listMergeRequestNotes(
  context: GitlabContext,
  doFetch: typeof fetch = fetch,
): Promise<HostComment[]> {
  const [self, members] = await Promise.all([
    selfUsername(context, doFetch),
    projectMembers(context, doFetch),
  ]);
  const notes = await fetchNotes(context, doFetch, self);
  if (members === undefined) return notes;
  return notes.map((note) => {
    const level = members.get(note.author);
    return {
      ...note,
      association: level === undefined ? "NONE" : associationFor(level),
    };
  });
}

/** The id of the reviewer's own note carrying `marker`, or `undefined`. */
async function findNote(
  context: GitlabContext,
  marker: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
  const own = await findOwn(
    await fetchNotes(context, doFetch),
    marker,
    () => selfUsername(context, doFetch),
  );
  return own?.id;
}

/**
 * Post the per-reviewer note: PUT to update in place, POST to create — always
 * POST in `"append"` mode, keeping earlier notes as history.
 */
export async function upsertMergeRequestNote(
  context: GitlabContext,
  name: string,
  markdown: string,
  doFetch: typeof fetch = fetch,
  mode: CommentMode = "update",
): Promise<void> {
  const marker = commentMarker(name);
  const body = commentBody(name, markdown);
  const root = `${context.api}/projects/${context.projectId}` +
    `/merge_requests/${context.mrIid}/notes`;
  const existing = mode === "append"
    ? undefined
    : await findNote(context, marker, doFetch);
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
    return (name, markdown, doFetch, mode) =>
      upsertMergeRequestNote(context, name, markdown, doFetch, mode);
  },
  listComments(token, env) {
    const context = resolveGitlabContext(token, env);
    if (context === undefined) return undefined;
    return (doFetch) => listMergeRequestNotes(context, doFetch);
  },
};
