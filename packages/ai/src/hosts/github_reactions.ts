// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * GitHub reactions: the progress signals on a pull request's description and
 * the acknowledgement on a command comment.
 *
 * A pull request's description is its issue body, so its reactions live under
 * `issues/<n>/reactions`. GitHub deletes a reaction by id, and the token the
 * reviewer holds (the Actions token, an App installation token) cannot ask
 * `GET /user` who it is. Every reaction GitHub answers a POST with names its
 * author, though, so the login is learned from the reviewer's own first
 * reaction; a withdrawal then lists the reactions of that content and deletes
 * only that login's — never another account's, and never creating one.
 *
 * @module
 */

import { dig } from "../json.ts";
import { type GithubContext, githubHeaders } from "./github.ts";
import {
  paginateLinked,
  type ReviewReactions,
  type ReviewSignal,
} from "./types.ts";

/** The GitHub REST API origin. */
const API = "https://api.github.com";

/**
 * The GitHub reaction content for each {@link ReviewSignal}. GitHub's reaction
 * set is fixed at eight, with no 🤏, so `minor` shows as 😕 `confused`.
 */
const CONTENT: Record<ReviewSignal, string> = {
  reviewing: "eyes",
  passed: "+1",
  minor: "confused",
  failed: "-1",
  recovered: "hooray",
  fixed: "rocket",
};

/** The reaction a successful POST answered with: its id and author's login. */
interface PostedReaction {
  /** The reaction's id. */
  id: number;
  /** The login of the account it belongs to, when GitHub said. */
  login?: string;
}

/**
 * POST reaction `content` to the reactions collection at `url`, answering the
 * token's own reaction — the one created (201), or the one already there
 * (200) — or `undefined` when GitHub refuses or the call fails. Never throws.
 */
export async function postReaction(
  url: string,
  token: string,
  content: string,
  doFetch: typeof fetch,
): Promise<PostedReaction | undefined> {
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const body: unknown = await response.json();
    const id = dig(body, "id");
    if (typeof id !== "number") return undefined;
    const login = dig(body, "user", "login");
    return typeof login === "string" && login !== "" ? { id, login } : { id };
  } catch {
    return undefined;
  }
}

/** The {@link ReviewReactions} on the description of `context`'s pull request. */
export function githubReactions(context: GithubContext): ReviewReactions {
  const reactions =
    `${API}/repos/${context.owner}/${context.repo}/issues/${context.pull}/reactions`;
  const headers = githubHeaders(context.token);
  /** The login the token reacts as, once a POST has told us. */
  let self: string | undefined;
  return {
    key: `github:${context.owner}/${context.repo}#${context.pull}`,
    async add(signal, doFetch) {
      const posted = await postReaction(
        reactions,
        context.token,
        CONTENT[signal],
        doFetch,
      );
      if (posted?.login !== undefined) self = posted.login;
      return posted !== undefined;
    },
    async remove(signal, doFetch) {
      const login = self;
      if (login === undefined) return false;
      const content = CONTENT[signal];
      try {
        const ids: number[] = [];
        await paginateLinked(
          `${reactions}?content=${encodeURIComponent(content)}&per_page=100`,
          headers,
          "GitHub",
          doFetch,
          (item) => {
            const id = dig(item, "id");
            if (
              typeof id === "number" && dig(item, "content") === content &&
              dig(item, "user", "login") === login
            ) ids.push(id);
          },
        );
        let removed = false;
        for (const id of ids) {
          const response = await doFetch(`${reactions}/${id}`, {
            method: "DELETE",
            headers,
          });
          await response.body?.cancel();
          if (response.ok) removed = true;
        }
        return removed;
      } catch {
        // Best-effort: a reaction left up is cosmetic, never a failed review.
        return false;
      }
    },
  };
}
