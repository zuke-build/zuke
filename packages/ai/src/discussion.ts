// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The review discussion: which PR comments the reviewer listens to, and how
 * they are bounded before reaching the model.
 *
 * The trust decisions here are the prompt-injection boundary for the comment
 * channel, and they are made **deterministically, in code, before any text
 * reaches a prompt**: a comment is included only when its author metadata —
 * asserted by the host API, not by the comment body — passes the configured
 * trust rules. A drive-by comment claiming to be the maintainer is dropped
 * here and the model never sees it; the model is never asked to judge who to
 * trust.
 *
 * @module
 */

import type { HostComment } from "./hosts/types.ts";

/**
 * The `author_association` values trusted by default: users GitHub itself
 * asserts own the repo, belong to its organisation, or were invited as
 * collaborators. `CONTRIBUTOR` (has ever had a commit merged) is deliberately
 * excluded — on a public repository it is too cheap to obtain.
 */
export const DEFAULT_TRUSTED_ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
];

/** Default cap on the comment text sent to the model, in ≈tokens. */
const DEFAULT_MAX_COMMENT_TOKENS = 4000;

/**
 * Fluent settings for {@link "./reviewer.ts".Reviewer.discussion} — who the
 * reviewer listens to on the PR thread, and how much of it the model may see.
 */
export class DiscussionSettings {
  #associations = [...DEFAULT_TRUSTED_ASSOCIATIONS];
  #authors: string[] = [];
  #maxTokens = DEFAULT_MAX_COMMENT_TOKENS;
  #threads = false;

  /**
   * Replace the trusted `author_association` set (default `OWNER`, `MEMBER`,
   * `COLLABORATOR`). Comments from authors outside it (and outside
   * {@link trustAuthors}) are dropped before the model sees them.
   */
  trustAssociations(...associations: string[]): this {
    this.#associations = associations.map((a) => a.toUpperCase());
    return this;
  }

  /**
   * Trust these author logins in addition to the association rule — e.g. an
   * outside collaborator whose review the project wants the reviewer to
   * engage with.
   */
  trustAuthors(...logins: string[]): this {
    this.#authors.push(...logins);
    return this;
  }

  /**
   * Cap the total comment text sent to the model at roughly this many tokens
   * (default 4000), newest comments kept first — so a wall of text cannot
   * crowd the diff and the rubric out of the context window.
   */
  maxCommentTokens(tokens: number): this {
    this.#maxTokens = tokens;
    return this;
  }

  /** INTERNAL: the trusted association set. */
  associations_(): string[] {
    return this.#associations;
  }

  /** INTERNAL: the extra trusted author logins. */
  authors_(): string[] {
    return this.#authors;
  }

  /**
   * Also anchor each finding to a file/line **review thread** on the pull
   * request, so a maintainer contests it by replying in that thread instead of
   * quoting its id somewhere on the PR.
   *
   * The summary comment is posted either way and stays the one source of
   * truth: it lists every finding — anchored or not — and carries the state
   * block, so a thread that cannot be posted never hides a finding. The
   * reviewer replies into the thread with the outcome and resolves it once the
   * finding is fixed or dismissed. GitHub only; on other hosts the reviewer
   * notes that and posts the summary alone.
   */
  threads(): this {
    this.#threads = true;
    return this;
  }

  /** INTERNAL: the total comment-token cap. */
  maxTokens_(): number {
    return this.#maxTokens;
  }

  /** INTERNAL: whether findings are also anchored to review threads. */
  threads_(): boolean {
    return this.#threads;
  }
}

/**
 * The comments the reviewer may listen to: human-authored (never bots — that
 * both mutes the reviewer's own comment and stops bot-to-bot loops) and from
 * an author the settings trust, by association or explicit allowlist. This is
 * the deterministic gate — untrusted comments never reach a prompt.
 */
export function trustedComments(
  comments: HostComment[],
  settings: DiscussionSettings,
): HostComment[] {
  const associations = settings.associations_();
  const authors = settings.authors_();
  return comments.filter((comment) => {
    if (comment.bot) return false;
    if (authors.includes(comment.author)) return true;
    return associations.includes(comment.association.toUpperCase());
  });
}

/**
 * The trusted comments that mention any of the given finding fingerprints,
 * keyed by fingerprint — the rebuttals the adjudication pass weighs. Requiring
 * an explicit id keeps the discussion anchored to concrete findings (the ids
 * every report prints) and gives unrelated chatter no path into the prompt.
 */
export function rebuttalsFor(
  comments: HostComment[],
  ids: string[],
): Map<string, HostComment[]> {
  const rebuttals = new Map<string, HostComment[]>();
  for (const id of ids) {
    if (id === "") continue;
    const mentioning = comments.filter((c) => c.body.includes(id));
    if (mentioning.length > 0) rebuttals.set(id, mentioning);
  }
  return rebuttals;
}

/**
 * Bound the rebuttal comments to the settings' token cap (≈4 chars/token),
 * newest first, truncating the comment that crosses the cap and dropping the
 * rest. Applied after {@link trustedComments}, so the cap spends its budget
 * only on text that already passed the trust gate.
 */
export function budgetComments(
  comments: HostComment[],
  settings: DiscussionSettings,
): HostComment[] {
  let remaining = settings.maxTokens_() * 4;
  const kept: HostComment[] = [];
  for (const comment of [...comments].reverse()) {
    if (remaining <= 0) break;
    const body = comment.body.length <= remaining
      ? comment.body
      : `${comment.body.slice(0, remaining)}\n… (comment truncated) …`;
    remaining -= comment.body.length;
    kept.push({ ...comment, body });
  }
  return kept.reverse();
}
