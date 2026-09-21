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

import type { FindingThread, HostComment } from "./hosts/types.ts";
import { AiReviewError } from "./errors.ts";

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
 * A mention maintainers address commands to: one word of letters, digits and
 * `@/_.:-`, e.g. `@zuke-build` — the same alphabet the workflow's comment
 * command is held to, so the two can be one string.
 */
const MENTION = /^[A-Za-z0-9@/_.:-]+$/;

/** Character cap on the reason an `accept` command records. */
const MAX_ACCEPT_REASON = 300;

/** The reason recorded when an `accept` command gives none. */
export const DEFAULT_ACCEPT_REASON = "accepted as intended by a maintainer";

/**
 * Fluent settings for {@link "./reviewer.ts".Reviewer.discussion} — who the
 * reviewer listens to on the PR thread, and how much of it the model may see.
 */
export class DiscussionSettings {
  #associations = [...DEFAULT_TRUSTED_ASSOCIATIONS];
  #authors: string[] = [];
  #maxTokens = DEFAULT_MAX_COMMENT_TOKENS;
  #threads = false;
  #mention?: string;

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

  /**
   * Take commands from maintainers, addressed to `mention` — e.g.
   * `"@zuke-build"`, the account the workflow's comment command is addressed
   * to, so one handle serves both.
   *
   * With it set, every review comment carries a collapsed **Commands** panel
   * listing what a maintainer can say, and a trusted comment starting with
   * `<mention> accept <id> <reason>` **accepts** the finding: it is recorded as
   * accepted for this pull request without adjudication, answered in its
   * thread and the thread resolved, and never re-raised on the pull request
   * by any reviewer, however it is reworded, moved or escalated. In a
   * finding's own thread the id may be left out. The trust gate is the one
   * rebuttals pass, decided in code from the host's author metadata — a
   * stranger's `accept` is dropped before anything reads it.
   *
   * The panel also lists `<mention> review`, the workflow's comment command
   * that runs the review on demand; pair this with `aiReviewWorkflow`'s
   * `command` so that both are true.
   */
  commands(mention: string): this {
    if (!MENTION.test(mention)) {
      throw new AiReviewError(
        `discussion commands: ${JSON.stringify(mention)} is not a valid ` +
          `mention — use one word of letters, digits and \`@/_.:-\`, ` +
          `e.g. "@zuke-build".`,
      );
    }
    this.#mention = mention;
    return this;
  }

  /** INTERNAL: the total comment-token cap. */
  maxTokens_(): number {
    return this.#maxTokens;
  }

  /** INTERNAL: the mention commands are addressed to, when set. */
  mention_(): string | undefined {
    return this.#mention;
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

/** One `accept` command a trusted maintainer gave, for one finding. */
export interface Acceptance {
  /** The stable login of the maintainer who accepted the finding. */
  author: string;
  /** The author's readable name, when the host's login is not one. */
  displayName?: string;
  /** The reason given, bounded, or {@link DEFAULT_ACCEPT_REASON}. */
  reason: string;
}

/**
 * The `accept` commands among `comments`, keyed by the finding they name —
 * the maintainer's outright decision, parsed here in code so that no prompt
 * ever weighs it.
 *
 * A command is a comment whose body **starts** with `<mention> accept`
 * (the mention matched case-insensitively, as the workflow's gate matches
 * its command), so a reply that quotes one does not count. The finding is
 * the first word after `accept` when that word is one of `ids`; otherwise,
 * for a reply inside one of the reviewer's own threads, it is that thread's
 * finding and the whole remainder is the reason. Anything else — an unknown
 * id, a top-level comment naming none — is ignored: a maintainer can only
 * accept a finding the reviewer is tracking. The newest command for a
 * finding wins, so a maintainer can restate a reason. `comments` must already
 * have passed {@link trustedComments}; the trust decision is not repeated
 * here.
 */
export function acceptances(
  comments: readonly HostComment[],
  mention: string,
  ids: readonly string[],
  threads: ReadonlyMap<string, FindingThread>,
): Map<string, Acceptance> {
  const owner = new Map<number, string>();
  for (const thread of threads.values()) {
    for (const reply of thread.replies) owner.set(reply.id, thread.id);
  }
  const prefix = `${mention.toLowerCase()} accept`;
  const accepted = new Map<string, Acceptance>();
  for (const comment of comments) {
    const body = comment.body.trim();
    if (!body.toLowerCase().startsWith(prefix)) continue;
    const rest = body.slice(prefix.length);
    if (rest !== "" && !/^\s/.test(rest)) continue; // `acceptance`, say
    // The first word, less the backticks or the colon people wrap an id in.
    const token = rest.trim().split(/\s+/)[0] ?? "";
    const first = token.replace(/^[^0-9a-z]+/i, "").replace(/[^0-9a-z]+$/i, "");
    let id: string | undefined;
    let reason: string;
    if (ids.includes(first)) {
      id = first;
      reason = rest.trim().slice(token.length);
    } else {
      id = comment.kind === "review" ? owner.get(comment.id) : undefined;
      reason = rest;
    }
    if (id === undefined || !ids.includes(id)) continue;
    accepted.set(id, {
      author: comment.author,
      ...(comment.displayName !== undefined
        ? { displayName: comment.displayName }
        : {}),
      reason: acceptReason(reason),
    });
  }
  return accepted;
}

/**
 * The reason an `accept` command carries: the text after the command and its
 * id, less the punctuation people put between the two (`: ` or ` — `),
 * whitespace collapsed to one line and cut to {@link MAX_ACCEPT_REASON}.
 * The default when nothing is left — a bare `accept` is a decision too.
 */
function acceptReason(text: string): string {
  const collapsed = text
    .replace(/^[\s:—–-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed === "") return DEFAULT_ACCEPT_REASON;
  return collapsed.length <= MAX_ACCEPT_REASON
    ? collapsed
    : `${collapsed.slice(0, MAX_ACCEPT_REASON)}…`;
}
