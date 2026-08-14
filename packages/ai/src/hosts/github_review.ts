// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

import { type GithubContext, githubHeaders } from "./github.ts";
import { headSha, listReviewComments } from "./github_threads.ts";

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

/**
 * One suggestion comment's body: `prelude`, then the committable block holding
 * `replacement` (one array entry per line, or a single multi-line string).
 *
 * An **empty** `replacement` is the deletion form — GitHub reads an empty
 * `suggestion` block as "remove the targeted lines" — so a caller with nothing
 * to propose must pass `[]`, never `[""]`, which is a blank line inside the
 * block instead.
 */
export function suggestionBody(
  prelude: string,
  replacement: string[],
): string {
  return [prelude, "", "```suggestion", ...replacement, "```"].join("\n");
}

/**
 * The keys of zuke-fix suggestions already posted on the PR. Reads the same
 * paginated review-comment listing the review threads use — one endpoint, one
 * pagination loop — so a re-run never re-posts a suggestion whose marker sits
 * beyond the first page on a busy PR.
 */
async function existingKeys(
  context: GithubContext,
  doFetch: typeof fetch,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const { comments } = await listReviewComments(context, doFetch);
  for (const comment of comments) {
    const match = comment.body.match(/<!-- zuke-ai-fix:(.+?) -->/);
    if (match) keys.add(match[1]);
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
