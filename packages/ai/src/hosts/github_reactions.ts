// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * GitHub reactions: the progress signals on a pull request's description and
 * the acknowledgement on a command comment.
 *
 * A pull request's description is its issue body, so its reactions live under
 * `issues/<n>/reactions`. GitHub has no "delete my reaction of this content"
 * call, only a delete by id, and the token the reviewer holds (the Actions
 * token, an App installation token) cannot ask `GET /user` who it is — so a
 * withdrawal first POSTs the same content, which answers with the token's own
 * reaction (created, or the existing one), and then deletes that id. No
 * identity lookup, and another account's reaction is never touched.
 *
 * @module
 */

import { dig } from "../json.ts";
import { type GithubContext, githubHeaders } from "./github.ts";
import type { ReviewReactions, ReviewSignal } from "./types.ts";

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
};

/**
 * POST reaction `content` to the reactions collection at `url`, answering the
 * id of the token's own reaction — the one created, or the one already there —
 * or `undefined` when GitHub refuses or the call fails. Never throws.
 */
export async function postReaction(
  url: string,
  token: string,
  content: string,
  doFetch: typeof fetch,
): Promise<number | undefined> {
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
    const id = dig(await response.json(), "id");
    return typeof id === "number" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The {@link ReviewReactions} on the description of `context`'s pull request. */
export function githubReactions(context: GithubContext): ReviewReactions {
  const reactions =
    `${API}/repos/${context.owner}/${context.repo}/issues/${context.pull}/reactions`;
  return {
    key: `github:${context.owner}/${context.repo}#${context.pull}`,
    async add(signal, doFetch) {
      const id = await postReaction(
        reactions,
        context.token,
        CONTENT[signal],
        doFetch,
      );
      return id !== undefined;
    },
    async remove(signal, doFetch) {
      const id = await postReaction(
        reactions,
        context.token,
        CONTENT[signal],
        doFetch,
      );
      if (id === undefined) return false;
      try {
        const response = await doFetch(`${reactions}/${id}`, {
          method: "DELETE",
          headers: githubHeaders(context.token),
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
