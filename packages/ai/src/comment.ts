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
 * Both redact before handing anything to the host API, and they do it *here*
 * rather than at their four call sites for the reason core gives for doing the
 * same inside `appendJobSummary`: at the one function that publishes, a caller
 * cannot leak by forgetting to. A comment cannot be taken back — it is already
 * in the notification mails and the API history — so the guard has to be
 * unforgettable rather than merely available.
 *
 * @module
 */

import { type AnyParameter, detectCiHost } from "@zuke/core";
import { detectReviewHost, type EnvReader } from "./hosts.ts";
import { resolveGithubContext } from "./hosts/github.ts";
import { postSuggestions, type Suggestion } from "./hosts/github_review.ts";
import { resolveKey } from "./provider.ts";

/**
 * Mask the run's declared secrets in a piece of text — the shape of
 * `RemediationContext.redact`.
 *
 * Named once here, and imported by the fixers that thread it down to these
 * functions, so the three do not each spell out a function type that has to
 * stay in step.
 */
export type Redact = (text: string) => string;

/**
 * How to post a comment: the token source, the env reader, the redactor, and a
 * `fetch` seam.
 */
export interface CommentOptions {
  /** The token to post with; defaults to the host's conventional env var. */
  commentToken?: AnyParameter | string;
  /** The environment reader used to detect the host and read the token. */
  env: EnvReader;
  /**
   * Mask the run's declared secrets in anything bound for the pull request —
   * `RemediationContext.redact`, which core hands a remediation for exactly
   * this.
   *
   * Required, not optional. What these functions publish is a model's reply to
   * a prompt built from a failure, and that prompt carries the failed command
   * and its output, so a secret the build holds can come back in the reply. An
   * optional guard is the one that gets left out at the next call site; making
   * it part of the type means the compiler asks instead.
   */
  redact: Redact;
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
    await upsert(name, options.redact(markdown), options.fetch ?? fetch);
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
    // Inside the try, with the call: a redactor is supplied by the caller, so a
    // throwing one would otherwise escape this function and fail the build —
    // which is exactly the totality the doc comment above promises it will not
    // do. Masking that fails is a skipped courtesy, not a broken build.
    //
    // Only `body` is redacted. It is the model-authored half — the prose and
    // the committable `suggestion` block — and the sharper of the two publish
    // paths, because a reviewer can commit a suggestion in one click: a secret
    // reaching it would not merely be disclosed but proposed for check-in.
    // `path` and the `key` derived from it are diff coordinates that must match
    // the file for GitHub to accept the comment at all, so masking them would
    // break posting without hiding anything a secret could occupy.
    const masked = suggestions.map((suggestion) => ({
      ...suggestion,
      body: options.redact(suggestion.body),
    }));
    return await postSuggestions(context, masked, options.fetch ?? fetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${name}] could not post suggestions: ${message}`);
    return 0;
  }
}
