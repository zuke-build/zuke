// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Posting to the pull/merge request via the active CI host — the single overview
 * comment ({@link postComment}) and GitHub's inline suggestions
 * ({@link postGithubSuggestions}), both shared by the AI fixer and the agent
 * fixer. The overview comment is keyed by the fixer's name so re-runs update one
 * comment in place. Both are best-effort: a failure to post never breaks the
 * build.
 *
 * @module
 */

import { type AnyParameter, detectCiHost } from "@zuke/core";
import { detectReviewHost, type EnvReader } from "./hosts.ts";
import { resolveGithubContext } from "./hosts/github.ts";
import { postSuggestions, type Suggestion } from "./hosts/github_review.ts";
import { resolveKey } from "./provider.ts";

/** How to post a comment: the token source, the env reader, and a `fetch` seam. */
export interface CommentOptions {
  /** The token to post with; defaults to the host's conventional env var. */
  commentToken?: AnyParameter | string;
  /** The environment reader used to detect the host and read the token. */
  env: EnvReader;
  /** The `fetch` implementation (test seam). */
  fetch?: typeof fetch;
}

/**
 * Upsert a single comment, identified by `name`, on the current PR/MR. A no-op
 * when no CI host or PR context is detected (e.g. local runs).
 */
export async function postComment(
  name: string,
  markdown: string,
  options: CommentOptions,
): Promise<void> {
  const host = detectReviewHost(options.env);
  if (host === undefined) return;
  const token = options.commentToken !== undefined
    ? resolveKey(options.commentToken)
    : options.env(host.defaultTokenEnv) ?? "";
  const upsert = host.prepare(token, options.env);
  if (upsert === undefined) return;
  try {
    await upsert(name, markdown, options.fetch ?? fetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${name}] could not post PR comment: ${message}`);
  }
}

/**
 * Post `suggestions` as inline review comments on the pull request the ambient
 * environment describes, returning how many were created — the whole path from
 * "a fixer has suggestions" to "they are on the PR", so each fixer keeps only its
 * own mapping of findings to {@link Suggestion}s.
 *
 * Total by construction, because an inline suggestion is a courtesy and must
 * never fail a build: `0` off GitHub (the only host with committable
 * suggestions), `0` without a token or a PR context, and `0` plus a warning when
 * the API throws. A caller deciding whether to fall back to the overview comment
 * tests the count.
 */
export async function postGithubSuggestions(
  name: string,
  suggestions: Suggestion[],
  options: CommentOptions,
): Promise<number> {
  if (detectCiHost(options.env) !== "github") return 0;
  const token = options.commentToken !== undefined
    ? resolveKey(options.commentToken)
    : options.env("GITHUB_TOKEN") ?? "";
  const context = resolveGithubContext(token, options.env);
  if (context === undefined) return 0;
  try {
    return await postSuggestions(context, suggestions, options.fetch ?? fetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${name}] could not post suggestions: ${message}`);
    return 0;
  }
}
