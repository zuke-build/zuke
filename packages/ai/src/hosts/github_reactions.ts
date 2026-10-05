// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * GitHub reactions: the progress signals on a pull request's description, the
 * answers on a command comment and on maintainers' replies — all through
 * `GhTasks` from `@zuke/gh`, the one GitHub REST client the workspace keeps.
 *
 * A pull request's description is its issue body, so its reactions are the
 * issue's. GitHub deletes a reaction by id, and the token the reviewer holds
 * (the Actions token, an App installation token) cannot ask `GET /user` who it
 * is. Every reaction GitHub answers a POST with names its author, though, so
 * the login is learned from the reviewer's own first reaction; a withdrawal
 * then lists the reactions of that content and deletes only that login's —
 * never another account's, and never creating one.
 *
 * Every function here is total: `GhTasks` throws on a refusal, and a reaction
 * is a courtesy that must never fail a review, so each call is caught and
 * answered as `undefined` or `false`.
 *
 * @module
 */

import {
  type GhReaction,
  type GhReactionContent,
  type GhReactionSettings,
  GhTasks,
} from "@zuke/gh";
import type { GithubContext } from "./github.ts";
import type {
  ReplyReactions,
  ReplySignal,
  ReviewReactions,
  ReviewSignal,
} from "./types.ts";

/**
 * The GitHub reaction content for each {@link ReviewSignal}. GitHub's reaction
 * set is fixed at eight, with no 🤏, so `minor` shows as 😕 `confused`.
 */
const CONTENT: Record<ReviewSignal, GhReactionContent> = {
  reviewing: "eyes",
  passed: "+1",
  minor: "confused",
  failed: "-1",
  recovered: "hooray",
  fixed: "rocket",
};

/** The repository (`owner/repo`) and token a reaction is posted with. */
export interface ReactionTarget {
  /** `owner/repo`. */
  slug: string;
  /** The token to post with. */
  token: string;
}

/** The {@link ReactionTarget} of a resolved pull-request context. */
function targetOf(context: GithubContext): ReactionTarget {
  return { slug: `${context.owner}/${context.repo}`, token: context.token };
}

/** Bind `settings` to `target`'s repository and token, and to `doFetch`. */
function bound(
  target: ReactionTarget,
  doFetch: typeof fetch,
): (settings: GhReactionSettings) => GhReactionSettings {
  return (settings) =>
    settings.repo(target.slug).token(target.token).fetch(doFetch);
}

/**
 * React `content` on the subject `subject` picks, answering the token's own
 * reaction — the one created, or the one already there — or `undefined` when
 * GitHub refuses or the call fails. Never throws.
 */
export async function postReaction(
  target: ReactionTarget,
  subject: (settings: GhReactionSettings) => GhReactionSettings,
  content: GhReactionContent,
  doFetch: typeof fetch,
): Promise<GhReaction | undefined> {
  try {
    return await GhTasks.react((s) =>
      subject(bound(target, doFetch)(s)).content(content)
    );
  } catch {
    return undefined;
  }
}

/** The {@link ReviewReactions} on the description of `context`'s pull request. */
export function githubReactions(context: GithubContext): ReviewReactions {
  const description = (s: GhReactionSettings) => s.issue(context.pull);
  /** The login the token reacts as, once a reaction has told us. */
  let self: string | undefined;
  return {
    key: `github:${context.owner}/${context.repo}#${context.pull}`,
    async add(signal, doFetch) {
      const posted = await postReaction(
        targetOf(context),
        description,
        CONTENT[signal],
        doFetch,
      );
      if (posted?.login !== undefined && posted.login !== "") {
        self = posted.login;
      }
      return posted !== undefined;
    },
    async remove(signal, doFetch) {
      const login = self;
      if (login === undefined) return false;
      const settings = (s: GhReactionSettings) =>
        description(bound(targetOf(context), doFetch)(s));
      try {
        const own = (await GhTasks.listReactions((s) =>
          settings(s).content(CONTENT[signal])
        )).filter((r) =>
          r.login === login && r.content === CONTENT[signal]
        );
        let removed = false;
        for (const reaction of own) {
          try {
            await GhTasks.deleteReaction((s) => settings(s).id(reaction.id));
            removed = true;
          } catch {
            // One refused deletion does not stop the others.
          }
        }
        return removed;
      } catch {
        // Best-effort: a reaction left up is cosmetic, never a failed review.
        return false;
      }
    },
  };
}

/** The GitHub reaction content for each {@link ReplySignal}. */
const REPLY_CONTENT: Record<ReplySignal, GhReactionContent> = {
  read: "eyes",
  accepted: "heart",
};

/**
 * The {@link ReplyReactions} on `context`'s pull request: a conversation
 * comment is an issue comment, a review-thread reply a review comment.
 */
export function githubReplyReactions(context: GithubContext): ReplyReactions {
  return {
    async react(comment, signal, doFetch) {
      const posted = await postReaction(
        targetOf(context),
        (s) =>
          comment.kind === "review"
            ? s.reviewComment(comment.id)
            : s.issueComment(comment.id),
        REPLY_CONTENT[signal],
        doFetch,
      );
      return posted !== undefined;
    },
  };
}
