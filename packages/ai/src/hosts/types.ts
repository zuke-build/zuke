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
 * Upsert one PR/MR comment keyed by the hidden marker derived from `name`.
 * Closes over its host-specific context — the reviewer never sees that shape.
 */
export type UpsertComment = (
  name: string,
  markdown: string,
  doFetch: typeof fetch,
) => Promise<void>;

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
