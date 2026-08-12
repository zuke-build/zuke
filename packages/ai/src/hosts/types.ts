/**
 * The {@link ReviewHost} contract — what each per-host integration provides so
 * the {@link "../reviewer.ts".Reviewer} can post its assessment to a pull
 * (or merge) request without knowing which provider it's running on.
 *
 * @module
 */

import { AiReviewError } from "../errors.ts";

/** Read an environment variable, tolerating an absent `--allow-env` permission. */
export type EnvReader = (name: string) => string | undefined;

/** The default env reader — `Deno.env.get` wrapped to return `undefined` on denial. */
export function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * How a reviewer's PR/MR comment is posted across runs: `"update"` keeps one
 * comment per reviewer, edited in place; `"append"` posts a fresh comment
 * every run, so earlier assessments — and their finding ids — remain on the
 * thread as history.
 */
export type CommentMode = "update" | "append";

/**
 * Post one PR/MR comment keyed by the hidden marker derived from `name` —
 * edited in place or appended per `mode` (default `"update"`). Closes over its
 * host-specific context — the reviewer never sees that shape.
 */
export type UpsertComment = (
  name: string,
  markdown: string,
  doFetch: typeof fetch,
  mode?: CommentMode,
) => Promise<void>;

/**
 * One comment on the pull/merge request, in the host-neutral shape the
 * discussion feature consumes. The `author`, `association`, and `bot` fields
 * are resolved by the host integration from the API's own metadata — never
 * from the comment text — so trust decisions made on them cannot be forged by
 * whoever wrote the body.
 */
export interface HostComment {
  /** The host's numeric id for the comment. */
  id: number;
  /** The raw Markdown body of the comment (untrusted text). */
  body: string;
  /**
   * The author's **stable** identifier, as reported by the host API — the one
   * trust is keyed on (`.trustAuthors(...)`, and each host's membership
   * lookup). It must be an identifier the account cannot re-point at will:
   * GitHub's `login`, GitLab's `username`, Azure's identity `id`, Bitbucket's
   * account `uuid`. A display alias (Bitbucket's `nickname`, Azure's
   * `displayName`) is self-assigned and not unique, so it belongs in
   * {@link displayName}, never here — keying trust on one would let an outsider
   * inherit a maintainer's standing by renaming themselves.
   */
  author: string;
  /**
   * A human-readable label for the author, when the host's stable identifier is
   * not itself readable. Used only for attribution in the report and the
   * adjudication prompt — never for a trust decision. Absent when `author` is
   * already the readable name.
   */
  displayName?: string;
  /**
   * The author's relationship to the repository as reported by the host API
   * (GitHub's `author_association`: `OWNER`, `MEMBER`, `COLLABORATOR`,
   * `CONTRIBUTOR`, `NONE`, …). Empty when the host does not report one.
   */
  association: string;
  /** Whether the author is a bot/app account (e.g. the reviewer itself). */
  bot: boolean;
  /**
   * Which stream the host read this comment from — `"review"` for a comment on
   * a file/line review thread, absent for a top-level pull-request comment.
   * Numeric ids are unique only **within** a stream, so anything keying a
   * comment to a finding by id must key on both.
   */
  kind?: "review";
}

/** How a finding's review thread was last answered by the reviewer. */
export type ThreadOutcome = "fixed" | "dismissed" | "upheld" | "reopened";

/** The raw material one review-comment listing yields. */
export interface ReviewComments {
  /** Every review comment on the pull request, host-neutral, in listing order. */
  comments: HostComment[];
  /** Review-comment id → the id of the comment it replies to. */
  parents: Map<number, number>;
  /** The identity the token authenticates as, for {@link ownAuthor}. */
  resolveSelf(): Promise<string | undefined>;
}

/** One finding's review thread, as it currently stands on the pull request. */
export interface FindingThread {
  /** The canonical finding fingerprint the root comment's marker declares. */
  id: string;
  /** The root comment's id — replies are posted against it. */
  rootId: number;
  /** Outcomes the reviewer has already replied into this thread, oldest first. */
  outcomes: ThreadOutcome[];
  /** Replies **not** authored by the reviewer — untrusted until filtered. */
  replies: HostComment[];
}

/**
 * How one thread write ended: `"created"` on success, `"rejected"` when the
 * host refused this one comment (an anchor it will not accept), `"stop"` when
 * the phase must halt immediately (rate limited, forbidden, server error).
 */
export type ThreadPost = "created" | "rejected" | "stop";

/**
 * The review-thread operations a host supports. Optional on
 * {@link ReviewHost}: a host without them cannot anchor findings inline, and
 * the reviewer falls back to the summary table with a note.
 */
export interface ReviewThreads {
  /** Every review comment on the pull request, with its reply parentage. */
  list(doFetch: typeof fetch): Promise<ReviewComments>;
  /** The head commit a new thread anchors to, or `undefined` when unavailable. */
  headSha(doFetch: typeof fetch): Promise<string | undefined>;
  /** Open one thread anchored at `path`:`line` on the right side of `sha`. */
  open(
    doFetch: typeof fetch,
    sha: string,
    path: string,
    line: number,
    body: string,
  ): Promise<ThreadPost>;
  /** Reply into an existing thread, identified by its root comment id. */
  reply(
    doFetch: typeof fetch,
    rootId: number,
    body: string,
  ): Promise<ThreadPost>;
  /**
   * Resolve (or unresolve) threads by root comment id, returning how many
   * succeeded. Never throws — resolution is the losable half of the feature.
   */
  setResolved(
    doFetch: typeof fetch,
    rootIds: readonly number[],
    resolved: boolean,
  ): Promise<number>;
}

/**
 * List the comments on the active pull/merge request. Closes over its
 * host-specific context, like {@link UpsertComment}.
 */
export type ListComments = (doFetch: typeof fetch) => Promise<HostComment[]>;

/**
 * A pull-request commenting integration for one CI host. Each implementation
 * (`hosts/github.ts`, `hosts/gitlab.ts`, …) resolves its context from the
 * ambient environment and returns a closure that posts (and updates) one
 * comment per reviewer.
 */
export interface ReviewHost {
  /** A short label for the host, used in skip/diagnostic messages. */
  readonly label: string;
  /** Env var the reviewer reads when `.commentToken(...)` isn't set. */
  readonly defaultTokenEnv: string;
  /**
   * Resolve the host context from the environment and return a closure that
   * upserts one comment. Returns `undefined` when the environment is missing
   * a required signal (e.g. no PR id) — commenting then skips silently.
   */
  prepare(token: string, env: EnvReader): UpsertComment | undefined;
  /**
   * Resolve the host context and return a closure that lists the PR/MR
   * comments (for the discussion feature). Optional — a host without it
   * simply cannot drive a review discussion; `undefined` from the closure
   * factory means the environment lacks a PR context, as in `prepare`.
   */
  listComments?(token: string, env: EnvReader): ListComments | undefined;
  /**
   * Resolve the host context and return its review-thread operations, or
   * `undefined` when the environment has no pull-request context — as in
   * `prepare`. Optional: a host without it keeps every finding in the summary
   * table.
   */
  reviewThreads?(token: string, env: EnvReader): ReviewThreads | undefined;
}

/** The Markdown header that every PR comment opens with, identifying Zuke. */
export const HEADER = "🤖 **[Zuke](https://zuke.build) AI review**";

/**
 * Cap on pages followed when scanning for an existing comment. A safety bound so
 * a misbehaving API can't loop forever; 100 pages × 100 per page = 10k comments,
 * far beyond any real PR. (caveat: fixed cap; the marker is our own recent
 * comment, so it is found long before this on any real thread.)
 */
export const MAX_COMMENT_PAGES = 100;

/**
 * The next-page URL from an RFC-5988 `Link` header (GitHub, GitLab), or
 * `undefined` when there is no `rel="next"`. Following it lets a marker scan
 * page past the first 100 comments instead of missing an older marker and
 * posting a duplicate.
 */
export function nextLink(header: string | null): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }
  return undefined;
}

/** Render the hidden marker (an HTML comment) used to identify a reviewer's prior comment. */
export function commentMarker(name: string): string {
  return `<!-- zuke-ai-review:${name} -->`;
}

/**
 * The reviewer's own prior comment carrying `marker`, or `undefined` — the one
 * authorship rule every host shares.
 *
 * The marker alone is not proof of authorship: anyone can paste it into a
 * comment, and the reviewer's token can usually edit any comment on the PR — so
 * a substring match would let an attacker plant a marker and have the reviewer
 * adopt (and trust, and overwrite) their comment. A match therefore requires
 * the marker to **open** the body — the reviewer's own comments always lead
 * with it, while a bot that merely quotes or echoes another comment prefixes
 * its own text — **and** the author to be a bot/service account the host
 * attributes as such, or the identity the token itself authenticates as
 * (`resolveSelf`, consulted only when no bot matched, so hosts that already
 * fold self-identity into {@link HostComment.bot} can omit it).
 */
export async function findOwn(
  comments: HostComment[],
  marker: string,
  resolveSelf?: () => Promise<string | undefined>,
): Promise<HostComment | undefined> {
  const matches = comments.filter((comment) => comment.body.startsWith(marker));
  const bot = matches.find((comment) => ownAuthor(comment, undefined));
  if (bot !== undefined) return bot;
  if (matches.length === 0 || resolveSelf === undefined) return undefined;
  const self = await resolveSelf();
  if (self === undefined || self === "") return undefined;
  return matches.find((comment) => ownAuthor(comment, self));
}

/**
 * Whether `comment` is the reviewer's own on the **author** side: a bot or
 * service account the host itself attributes as such, or the identity `self`
 * the token authenticates as. The marker check is the caller's half of the
 * rule — see {@link findOwn}, which combines the two.
 *
 * Kept separate because review threads need the same author test on comments
 * they locate by a different marker, and a second copy of this rule is exactly
 * the kind that drifts.
 */
export function ownAuthor(
  comment: HostComment,
  self: string | undefined,
): boolean {
  if (comment.bot) return true;
  return self !== undefined && self !== "" && comment.author === self;
}

/** Compose the final comment body: marker + header + assessment markdown. */
export function commentBody(name: string, markdown: string): string {
  return `${commentMarker(name)}\n${HEADER}\n\n${markdown}`;
}

/**
 * Throw an {@link AiReviewError} for a non-2xx response, naming the host in the
 * message (e.g. `label` `"GitLab"` → "GitLab API error: HTTP 404"). Cancels the
 * body first so the connection is released. Shared by every host integration.
 */
export async function ensureOk(
  response: Response,
  label: string,
): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiReviewError(`${label} API error: HTTP ${response.status}`);
  }
}

/**
 * The common JSON request headers for a host REST call — `accept` and
 * `content-type` of `application/json`, the `zuke-ai` user-agent — merged with
 * the host's own `auth` header(s) (a bearer `authorization`, GitLab's
 * `PRIVATE-TOKEN`, …).
 */
export function jsonHeaders(
  auth: Record<string, string>,
): Record<string, string> {
  return {
    ...auth,
    "accept": "application/json",
    "content-type": "application/json",
    "user-agent": "zuke-ai",
  };
}
