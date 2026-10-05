// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `src/reaction.ts` and `src/collaborator.ts` — the reaction
 * tasks and the collaborator-permission lookup, through `GhTasks`.
 *
 * `fetch` is injected via the settings seam, so none of this touches the
 * network.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { type GhReactionSettings, GhTasks } from "../mod.ts";
import { GhApiError } from "../src/api.ts";

/** One recorded request. */
interface Call {
  method: string;
  url: string;
  body: string;
  authorization: string | null;
}

/** A fake transport answering every call with `answer`. */
function fakeFetch(
  answer: (url: URL, method: string) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: url.href,
      body: typeof init?.body === "string" ? init.body : "",
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Promise.resolve(answer(url, method));
  };
  return { fetch: impl, calls };
}

const REPO = "https://api.github.com/repos/acme/app";

Deno.test("react posts the content on an issue, a conversation comment or a review comment", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(
      JSON.stringify({ id: 7, content: "eyes", user: { login: "bot[bot]" } }),
      { status: 201 },
    )
  );
  const base = (s: GhReactionSettings) =>
    s.repo("acme/app").token("tkn").fetch(fetch).content("eyes");
  assertEquals(await GhTasks.react((s) => base(s).issue(12)), {
    id: 7,
    content: "eyes",
    login: "bot[bot]",
  });
  await GhTasks.react((s) => base(s).issueComment(34));
  await GhTasks.react((s) => base(s).reviewComment(56));
  assertEquals(calls.map((c) => [c.method, c.url]), [
    ["POST", `${REPO}/issues/12/reactions`],
    ["POST", `${REPO}/issues/comments/34/reactions`],
    ["POST", `${REPO}/pulls/comments/56/reactions`],
  ]);
  assertEquals(JSON.parse(calls[0].body), { content: "eyes" });
  assertEquals(calls[0].authorization, "Bearer tkn");
});

Deno.test("react answers a reaction GitHub reports without an author", async () => {
  const { fetch } = fakeFetch(() =>
    new Response(JSON.stringify({ id: 3, content: "+1" }))
  );
  assertEquals(
    await GhTasks.react((s) =>
      s.repo("acme/app").token("t").fetch(fetch).issue(1).content("+1")
    ),
    { id: 3, content: "+1" },
  );
});

Deno.test("the reaction tasks name what is missing, and refuse an id that is not one", async () => {
  const { fetch, calls } = fakeFetch(() => new Response("{}"));
  const settings = (s: GhReactionSettings) =>
    s.repo("acme/app").token("t").fetch(fetch);
  await assertRejects(
    () => GhTasks.react((s) => settings(s).content("eyes")),
    Error,
    "requires .issue(...), .issueComment(...) or .reviewComment(...)",
  );
  await assertRejects(
    () => GhTasks.react((s) => settings(s).issue(1)),
    Error,
    "reacting requires .content(...)",
  );
  await assertRejects(
    () => GhTasks.deleteReaction((s) => settings(s).issue(1)),
    Error,
    "deleting a reaction requires .id(...)",
  );
  await assertRejects(
    () => GhTasks.react((s) => settings(s).issue(-1).content("eyes")),
    Error,
    "expected a positive integer",
  );
  await assertRejects(
    () => GhTasks.deleteReaction((s) => settings(s).issue(1).id(1.5)),
    Error,
    "expected a positive integer",
  );
  await assertRejects(() => GhTasks.react(), Error, "requires .issue(...)");
  assertEquals(calls, []);
});

Deno.test("listReactions follows the pages, filtered by content when set", async () => {
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: from + i,
      content: "-1",
      user: { login: i % 2 === 0 ? "bot[bot]" : "someone" },
    }));
  const { fetch, calls } = fakeFetch((url) =>
    new Response(JSON.stringify(
      url.searchParams.get("page") === "1" ? page(1, 100) : page(101, 2),
    ))
  );
  const reactions = await GhTasks.listReactions((s) =>
    s.repo("acme/app").token("t").fetch(fetch).issue(9).content("-1")
  );
  assertEquals(reactions.length, 102);
  assertEquals(reactions[0], { id: 1, content: "-1", login: "bot[bot]" });
  assertEquals(calls.map((c) => c.url), [
    `${REPO}/issues/9/reactions?per_page=100&page=1&content=-1`,
    `${REPO}/issues/9/reactions?per_page=100&page=2&content=-1`,
  ]);
  // Unfiltered, and an answer that is not a list ends the listing.
  const odd = fakeFetch(() => new Response(JSON.stringify({})));
  assertEquals(
    await GhTasks.listReactions((s) =>
      s.repo("acme/app").token("t").fetch(odd.fetch).issueComment(4)
    ),
    [],
  );
  assertEquals(
    odd.calls[0].url,
    `${REPO}/issues/comments/4/reactions?per_page=100&page=1`,
  );
});

Deno.test("deleteReaction deletes by id, and a refusal is a GhApiError", async () => {
  const { fetch, calls } = fakeFetch((_url, method) =>
    method === "DELETE" ? new Response(null, { status: 204 }) : new Response()
  );
  await GhTasks.deleteReaction((s) =>
    s.repo("acme/app").token("t").fetch(fetch).reviewComment(5).id(77)
  );
  assertEquals(calls.map((c) => [c.method, c.url]), [
    ["DELETE", `${REPO}/pulls/comments/5/reactions/77`],
  ]);
  const refused = fakeFetch(() => new Response("nope", { status: 403 }));
  const error = await assertRejects(
    () =>
      GhTasks.deleteReaction((s) =>
        s.repo("acme/app").token("t").fetch(refused.fetch).issue(1).id(2)
      ),
    GhApiError,
  );
  assertEquals(error instanceof GhApiError ? error.status : 0, 403);
});

Deno.test("collaboratorPermission reads the permission and the role", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ permission: "write", role_name: "maintain" }))
  );
  assertEquals(
    await GhTasks.collaboratorPermission((s) =>
      s.repo("acme/app").token("t").fetch(fetch).login("mona-lisa")
    ),
    { permission: "write", roleName: "maintain" },
  );
  assertEquals(calls[0].url, `${REPO}/collaborators/mona-lisa/permission`);
});

Deno.test("collaboratorPermission refuses a login that could change the path, and fails closed", async () => {
  const { fetch, calls } = fakeFetch(() => new Response("{}"));
  for (const login of ["../../evil", "a b", ""]) {
    await assertRejects(
      () =>
        GhTasks.collaboratorPermission((s) =>
          s.repo("acme/app").token("t").fetch(fetch).login(login)
        ),
      Error,
      "refusing to use",
    );
  }
  await assertRejects(
    () => GhTasks.collaboratorPermission((s) => s.repo("a/b").token("t")),
    Error,
    "requires .login(...)",
  );
  assertEquals(calls, []);
  // An answer without the fields is an error, never a default standing.
  const blank = fakeFetch(() => new Response("{}"));
  const error = await assertRejects(
    () =>
      GhTasks.collaboratorPermission((s) =>
        s.repo("acme/app").token("t").fetch(blank.fetch).login("x")
      ),
    Error,
  );
  assertStringIncludes(error.message, "permission");
  const refused = fakeFetch(() => new Response("no", { status: 404 }));
  await assertRejects(
    () =>
      GhTasks.collaboratorPermission((s) =>
        s.repo("acme/app").token("t").fetch(refused.fetch).login("x")
      ),
    GhApiError,
  );
});

Deno.test("the API root is configurable for GitHub Enterprise", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ permission: "read", role_name: "read" }))
  );
  await GhTasks.collaboratorPermission((s) =>
    s.baseUrl("https://ghe.example/api/v3/").repo("acme/app").token("t")
      .fetch(fetch).login("x")
  );
  const reacted = fakeFetch(() => new Response(JSON.stringify({ id: 1 })));
  await GhTasks.react((s) =>
    s.baseUrl("https://ghe.example/api/v3").repo("acme/app").token("t")
      .fetch(reacted.fetch).issue(1).content("heart")
  );
  assertEquals(
    calls[0].url,
    "https://ghe.example/api/v3/repos/acme/app/collaborators/x/permission",
  );
  assertEquals(
    reacted.calls[0].url,
    "https://ghe.example/api/v3/repos/acme/app/issues/1/reactions",
  );
});
