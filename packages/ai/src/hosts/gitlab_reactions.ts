// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * GitLab reactions: the progress signals on a merge request's description,
 * posted as award emoji.
 *
 * GitLab deletes an award by id, and an award carries its author, so a
 * withdrawal lists the merge request's awards and deletes the ones of that
 * name the token's own user (`GET /user`) gave — never another account's.
 *
 * @module
 */

import { dig } from "../json.ts";
import { type GitlabContext, paginate, selfUsername } from "./gitlab.ts";
import {
  jsonHeaders,
  type ReviewReactions,
  type ReviewSignal,
} from "./types.ts";

/** The GitLab award-emoji name for each {@link ReviewSignal}. */
const NAME: Record<ReviewSignal, string> = {
  reviewing: "eyes",
  passed: "thumbsup",
  minor: "pinching_hand",
  failed: "thumbsdown",
  recovered: "tada",
  fixed: "rocket",
};

/** What GitLab answers a POST for an award the user has already given. */
const ALREADY_AWARDED = "has already been taken";

/** The {@link ReviewReactions} on the description of `context`'s merge request. */
export function gitlabReactions(context: GitlabContext): ReviewReactions {
  const awards = `${context.api}/projects/${context.projectId}` +
    `/merge_requests/${context.mrIid}/award_emoji`;
  const headers = jsonHeaders({ "PRIVATE-TOKEN": context.token });
  return {
    key: `gitlab:${context.api}/projects/${context.projectId}!${context.mrIid}`,
    async add(signal, doFetch) {
      try {
        const response = await doFetch(awards, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: NAME[signal] }),
        });
        if (response.ok) {
          await response.body?.cancel();
          return true;
        }
        // GitLab refuses a second award of a name with "has already been
        // taken": the emoji is showing, which is what was asked.
        return (await response.text()).includes(ALREADY_AWARDED);
      } catch {
        return false;
      }
    },
    async remove(signal, doFetch) {
      const self = await selfUsername(context, doFetch);
      if (self === undefined || self === "") return false;
      try {
        const ids: number[] = [];
        await paginate(context, `${awards}?per_page=100`, doFetch, (item) => {
          const id = dig(item, "id");
          if (
            typeof id === "number" && dig(item, "name") === NAME[signal] &&
            dig(item, "user", "username") === self
          ) ids.push(id);
        });
        let removed = false;
        for (const id of ids) {
          const response = await doFetch(`${awards}/${id}`, {
            method: "DELETE",
            headers,
          });
          await response.body?.cancel();
          if (response.ok) removed = true;
        }
        return removed;
      } catch {
        // Best-effort: an award left up is cosmetic, never a failed review.
        return false;
      }
    },
  };
}
