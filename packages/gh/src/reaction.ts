// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reactions — the emoji on an issue or pull request, on a conversation
 * comment, or on a review-thread comment. REST-only: the `gh` CLI has no verb
 * for them.
 *
 * A pull request's description is its issue body, so its reactions are the
 * issue's: `.issue(n)` addresses both. A conversation comment on a pull request
 * is an issue comment; a comment in a review thread is a review comment, and
 * its reactions live elsewhere — the two id spaces overlap, so the subject is
 * named, never guessed.
 *
 * @module
 */

import {
  caller,
  DEFAULT_BASE_URL,
  type GhCall,
  isRecord,
  readNumber,
} from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/** A reaction, as GitHub spells its content: 👍 👎 😄 😕 ❤️ 🎉 🚀 👀. */
export type GhReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "rocket"
  | "eyes";

/** One reaction on a subject. */
export interface GhReaction {
  /** Its id — what {@link GhReactionApi.deleteReaction} takes. */
  id: number;
  /** What it is. */
  content: string;
  /** The login of the account that gave it, when GitHub said. */
  login?: string;
}

/**
 * What a reaction is on, as the REST paths address it: an issue (or a pull
 * request's description), a conversation comment, or a review comment.
 */
export type GhReactionSubject =
  | { kind: "issue"; id: number }
  | { kind: "issueComment"; id: number }
  | { kind: "reviewComment"; id: number };

/**
 * Settings for the reaction tasks: the subject, the content, and — for a
 * deletion — the reaction's id. `owner/repo` and the token fall back to the
 * Actions environment.
 */
export class GhReactionSettings {
  /** What the reaction is on. Set by {@link issue}, {@link issueComment} or {@link reviewComment}. */
  subject_?: GhReactionSubject;
  /** The reaction's content. Set by {@link content}. */
  content_?: GhReactionContent;
  /** The reaction to delete. Set by {@link id}. */
  id_?: number;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** An issue — or a pull request, whose description is its issue body. */
  issue(number: number): this {
    this.subject_ = { kind: "issue", id: number };
    return this;
  }

  /** A conversation comment on an issue or pull request. */
  issueComment(id: number): this {
    this.subject_ = { kind: "issueComment", id };
    return this;
  }

  /** A comment in a pull request's review thread. */
  reviewComment(id: number): this {
    this.subject_ = { kind: "reviewComment", id };
    return this;
  }

  /** The reaction to give, or — when listing — the only one to list. */
  content(value: GhReactionContent): this {
    this.content_ = value;
    return this;
  }

  /** The id of the reaction to delete. */
  id(value: number): this {
    this.id_ = value;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The token to authenticate with. Defaults to `GITHUB_TOKEN`. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }
}

/** The reaction operations {@link GhTasks} exposes. */
export interface GhReactionApi {
  /**
   * React with `.content(...)` on the subject. GitHub keeps one reaction of
   * each content per account, so reacting twice answers the reaction already
   * there rather than adding another.
   */
  react(
    configure?: (settings: GhReactionSettings) => GhReactionSettings,
  ): Promise<GhReaction>;
  /** The subject's reactions — only `.content(...)`'s when it is set. */
  listReactions(
    configure?: (settings: GhReactionSettings) => GhReactionSettings,
  ): Promise<GhReaction[]>;
  /**
   * Delete reaction `.id(...)` from the subject. GitHub lets an account
   * delete only its own.
   */
  deleteReaction(
    configure?: (settings: GhReactionSettings) => GhReactionSettings,
  ): Promise<void>;
}

/** Cap on pages listed, so a misbehaving API cannot loop forever. */
const MAX_PAGES = 100;

/** Reject an id that is not a positive integer before it reaches a path. */
function assertId(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `refusing to use ${value} as ${what}: expected a positive integer.`,
    );
  }
}

/** The configured settings, the subject's reactions path, and a caller. */
function prepare(
  configure: ((s: GhReactionSettings) => GhReactionSettings) | undefined,
  operation: string,
): { settings: GhReactionSettings; path: string; call: GhCall } {
  const settings = configure?.(new GhReactionSettings()) ??
    new GhReactionSettings();
  const subject = settings.subject_;
  if (subject === undefined) {
    throw new Error(
      `${operation} requires .issue(...), .issueComment(...) or ` +
        `.reviewComment(...).`,
    );
  }
  assertId(subject.id, "a subject id");
  const path = subject.kind === "issue"
    ? `/issues/${subject.id}/reactions`
    : subject.kind === "issueComment"
    ? `/issues/comments/${subject.id}/reactions`
    : `/pulls/comments/${subject.id}/reactions`;
  const call = caller(
    settings.baseUrl_,
    resolveRepoSlug(settings.repo_, operation),
    resolveAuthToken(
      settings.token_,
      operation,
      ". It needs `issues: write` or `pull-requests: write`.",
    ),
    settings.fetch_,
  );
  return { settings, path, call };
}

/** One reaction from GitHub's JSON. */
function toReaction(value: unknown): GhReaction {
  const id = readNumber(value, "id", "reaction");
  const content = isRecord(value) && typeof value.content === "string"
    ? value.content
    : "";
  const user = isRecord(value) ? value.user : undefined;
  const login = isRecord(user) && typeof user.login === "string"
    ? user.login
    : undefined;
  return login === undefined ? { id, content } : { id, content, login };
}

/** Give the configured reaction. */
export async function react(
  configure?: (settings: GhReactionSettings) => GhReactionSettings,
): Promise<GhReaction> {
  const { settings, path, call } = prepare(configure, "reacting");
  if (settings.content_ === undefined) {
    throw new Error("reacting requires .content(...).");
  }
  return toReaction(await call("POST", path, { content: settings.content_ }));
}

/** List the subject's reactions, every page of them. */
export async function listReactions(
  configure?: (settings: GhReactionSettings) => GhReactionSettings,
): Promise<GhReaction[]> {
  const { settings, path, call } = prepare(configure, "listing reactions");
  const filter = settings.content_ === undefined
    ? ""
    : `&content=${encodeURIComponent(settings.content_)}`;
  const reactions: GhReaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await call(
      "GET",
      `${path}?per_page=100&page=${page}${filter}`,
    );
    if (!Array.isArray(items)) break;
    for (const item of items) reactions.push(toReaction(item));
    if (items.length < 100) break;
  }
  return reactions;
}

/** Delete the configured reaction. */
export async function deleteReaction(
  configure?: (settings: GhReactionSettings) => GhReactionSettings,
): Promise<void> {
  const { settings, path, call } = prepare(configure, "deleting a reaction");
  const id = settings.id_;
  if (id === undefined) {
    throw new Error("deleting a reaction requires .id(...).");
  }
  assertId(id, "a reaction id");
  await call("DELETE", `${path}/${id}`);
}
