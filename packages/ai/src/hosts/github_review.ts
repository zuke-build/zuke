/**
 * Post a fix as GitHub pull-request *review* comments with committable
 * `suggestion` blocks — the Copilot-style inline suggestion anchored to the
 * exact lines in the diff, with a "Commit suggestion" button. Distinct from the
 * single overview issue comment in `./github.ts`.
 *
 * A review comment must anchor to a commit and to lines that are part of the
 * diff; a line outside the diff is rejected by GitHub (422), so each suggestion
 * is posted best-effort and a rejected one is skipped without failing the rest.
 *
 * @module
 */

import { dig } from "../json.ts";
import { type GithubContext, githubHeaders } from "./github.ts";
import { ensureOk, MAX_COMMENT_PAGES, nextLink } from "./types.ts";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/** One inline suggestion anchored to a line range on the PR's new file. */
export interface Suggestion {
  /** Repository-relative file path (must match the diff). */
  path: string;
  /** The 1-based end line (RIGHT side) the suggestion replaces. */
  line: number;
  /** The 1-based start line, when the suggestion spans multiple lines. */
  startLine?: number;
  /** The comment body (Markdown), including a `suggestion` block. */
  body: string;
  /** A stable key so re-runs don't post the same suggestion twice. */
  key: string;
}

/** The hidden marker embedded in a suggestion comment, carrying its key. */
export function suggestionMarker(key: string): string {
  return `<!-- zuke-ai-fix:${key} -->`;
}

/** The PR head commit SHA — review comments must anchor to a commit. */
async function headSha(
  context: GithubContext,
  doFetch: typeof fetch,
): Promise<string | undefined> {
  const url =
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}`;
  const response = await doFetch(url, {
    headers: githubHeaders(context.token),
  });
  await ensureOk(response, "GitHub");
  const data: unknown = await response.json();
  const sha = dig(data, "head", "sha");
  return typeof sha === "string" ? sha : undefined;
}

/** The keys of zuke-fix suggestions already posted on the PR. */
async function existingKeys(
  context: GithubContext,
  doFetch: typeof fetch,
): Promise<Set<string>> {
  let url: string | undefined =
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}/comments?per_page=100`;
  const keys = new Set<string>();
  // Page through all review comments so a re-run never re-posts a suggestion
  // whose marker sits beyond the first page on a busy PR.
  for (let page = 0; url !== undefined && page < MAX_COMMENT_PAGES; page++) {
    const response = await doFetch(url, {
      headers: githubHeaders(context.token),
    });
    await ensureOk(response, "GitHub");
    const data: unknown = await response.json();
    if (Array.isArray(data)) {
      for (const item of data) {
        const body = dig(item, "body");
        if (typeof body !== "string") continue;
        const match = body.match(/<!-- zuke-ai-fix:(.+?) -->/);
        if (match) keys.add(match[1]);
      }
    }
    url = nextLink(response.headers.get("link"));
  }
  return keys;
}

/**
 * Post each suggestion as an inline review comment, skipping ones already
 * present (matched by key) and tolerating per-comment rejection (e.g. a line
 * not in the diff). Returns the number of comments created.
 */
export async function postSuggestions(
  context: GithubContext,
  suggestions: Suggestion[],
  doFetch: typeof fetch = fetch,
): Promise<number> {
  if (suggestions.length === 0) return 0;
  const sha = await headSha(context, doFetch);
  if (sha === undefined) return 0;
  const seen = await existingKeys(context, doFetch);
  const url =
    `${API}/repos/${context.owner}/${context.repo}/pulls/${context.pull}/comments`;
  let created = 0;
  for (const s of suggestions) {
    if (seen.has(s.key)) continue;
    const payload: Record<string, unknown> = {
      body: `${suggestionMarker(s.key)}\n${s.body}`,
      commit_id: sha,
      path: s.path,
      line: s.line,
      side: "RIGHT",
    };
    if (s.startLine !== undefined && s.startLine < s.line) {
      payload.start_line = s.startLine;
      payload.start_side = "RIGHT";
    }
    const response = await doFetch(url, {
      method: "POST",
      headers: githubHeaders(context.token),
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      created++;
    } else {
      // A line outside the diff (422) or similar: skip it, keep going.
      await response.body?.cancel();
    }
  }
  return created;
}
