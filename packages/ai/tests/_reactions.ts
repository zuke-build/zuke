// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The progress reactions a reviewer puts on a pull request's description
 * (GitHub reactions, GitLab award emoji), for the fake hosts in tests that are
 * about something else: they answer these with {@link reacted} without
 * recording them, so a test about the comment or the threads sees only the
 * calls it is about. `progress_test.ts` covers the reactions themselves.
 */
export const DESCRIPTION_REACTIONS =
  /\/issues\/\d+\/reactions|\/merge_requests\/\d+\/award_emoji/;

/** A reaction the host accepted. */
export const reacted = (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 201 }));

/** A reaction the fake GitHub holds. */
interface HeldReaction {
  /** The reaction content (`eyes`, `+1`, …). */
  content: string;
  /** Who gave it. */
  login: string;
  /** The URL of the collection it is in. */
  collection: string;
}

/**
 * A fake GitHub reactions API for the tests that are **about** reactions:
 * one reaction per content per account per collection, the way GitHub keeps
 * them, with POST (201 created, 200 already there), GET filtered by
 * `?content=` and DELETE by id. The bot reacts as `zuke-build[bot]`; `seed`
 * pre-loads reactions another run (or a person) left.
 *
 * `handle` answers a reactions call and returns `undefined` for anything
 * else, so a test's own fake can fall through to it. `on(url)` lists the
 * contents held on a collection, sorted; `log` records every change as
 * `+content` / `-content` with the collection's URL.
 */
export function fakeReactions(
  seed: Array<{ collection: string; content: string; login?: string }> = [],
): {
  handle(url: string, init?: RequestInit): Promise<Response> | undefined;
  on(collection: string): string[];
  log: Array<{ change: string; collection: string }>;
} {
  const held = new Map<number, HeldReaction>();
  const log: Array<{ change: string; collection: string }> = [];
  let next = 1;
  for (const s of seed) {
    held.set(next++, {
      content: s.content,
      login: s.login ?? "zuke-build[bot]",
      collection: s.collection,
    });
  }
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  return {
    handle(url, init) {
      const method = init?.method ?? "GET";
      const parsed = new URL(url);
      const path = `${parsed.origin}${parsed.pathname}`;
      if (!/\/reactions(\/\d+)?$/.test(path)) return undefined;
      const byId = path.match(/^(.*\/reactions)\/(\d+)$/);
      if (byId !== null && method === "DELETE") {
        const id = Number(byId[2]);
        const reaction = held.get(id);
        if (reaction === undefined || reaction.login !== "zuke-build[bot]") {
          return json({}, 404);
        }
        held.delete(id);
        log.push({ change: `-${reaction.content}`, collection: byId[1] });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === "POST") {
        const content = JSON.parse(String(init?.body)).content;
        for (const [id, r] of held) {
          if (
            r.collection === path && r.content === content &&
            r.login === "zuke-build[bot]"
          ) return json({ id, user: { login: r.login } });
        }
        const id = next++;
        held.set(id, { content, login: "zuke-build[bot]", collection: path });
        log.push({ change: `+${content}`, collection: path });
        return json({ id, user: { login: "zuke-build[bot]" } }, 201);
      }
      const content = parsed.searchParams.get("content");
      return json(
        [...held]
          .filter(([, r]) =>
            r.collection === path && (content === null || r.content === content)
          )
          .map(([id, r]) => ({
            id,
            content: r.content,
            user: { login: r.login },
          })),
      );
    },
    on(collection) {
      return [...held.values()]
        .filter((r) => r.collection === collection)
        .map((r) => r.content)
        .sort();
    },
    log,
  };
}
