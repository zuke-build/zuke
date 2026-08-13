// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import type { GithubContext } from "../src/hosts/github.ts";
import { githubHost } from "../src/hosts/github.ts";
import {
  headSha,
  listReviewComments,
  openThread,
  replyToThread,
  setThreadsResolved,
} from "../src/hosts/github_threads.ts";

const CONTEXT: GithubContext = {
  token: "tkn",
  owner: "zuke-build",
  repo: "zuke",
  pull: 7,
};

/** A recorded request. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/** A reader over a fixed env map. */
function env(map: Record<string, string>): (key: string) => string | undefined {
  return (key) => map[key];
}

/**
 * A fake GitHub API. `routes` maps a URL substring to the response to serve;
 * anything unmatched is a 404 so an unexpected call is visible rather than
 * silently succeeding.
 */
function fake(
  routes: Array<[string, () => Response]>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    for (const [match, respond] of routes) {
      if (url.includes(match)) return Promise.resolve(respond());
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** A JSON response. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

Deno.test("a review-comment listing carries parentage and the review kind", async () => {
  const { fetch } = fake([[
    "/pulls/7/comments",
    () =>
      json([
        { id: 1, body: "root", user: { login: "zuke", type: "Bot" } },
        {
          id: 2,
          body: "reply",
          in_reply_to_id: 1,
          user: { login: "dev", type: "User" },
          author_association: "MEMBER",
        },
      ]),
  ]]);
  const listing = await listReviewComments(CONTEXT, fetch);
  assertEquals(listing.comments.length, 2);
  // The kind distinguishes the stream: review-comment ids and issue-comment
  // ids are separate sequences that can collide.
  assertEquals(listing.comments.every((c) => c.kind === "review"), true);
  assertEquals(listing.comments[1].association, "MEMBER");
  assertEquals(listing.parents.get(2), 1);
  assertEquals(listing.parents.has(1), false);
});

Deno.test("a review-comment listing follows Link pagination", async () => {
  const page2 =
    "https://api.github.com/repos/zuke-build/zuke/pulls/7/comments?page=2";
  const { fetch, calls } = fake([
    [
      "page=2",
      () => json([{ id: 2, body: "second page", user: { type: "Bot" } }]),
    ],
    [
      "/pulls/7/comments",
      () =>
        new Response(JSON.stringify([{ id: 1, body: "first", user: {} }]), {
          headers: { link: `<${page2}>; rel="next"` },
        }),
    ],
  ]);
  const listing = await listReviewComments(CONTEXT, fetch);
  // A thread beyond the first page must be found, or it is posted again.
  assertEquals(listing.comments.map((c) => c.id), [1, 2]);
  assertEquals(calls.length, 2);
});

Deno.test("opening a thread anchors to the head commit on the right side", async () => {
  const { fetch, calls } = fake([["/pulls/7/comments", () => json({ id: 9 })]]);
  const result = await openThread(
    CONTEXT,
    fetch,
    "deadbeef",
    "src/app.ts",
    12,
    "<!-- marker -->\nbody",
  );
  assertEquals(result, "created");
  const payload = JSON.parse(calls[0].body);
  assertEquals(calls[0].method, "POST");
  assertEquals(payload.commit_id, "deadbeef");
  assertEquals(payload.path, "src/app.ts");
  assertEquals(payload.line, 12);
  assertEquals(payload.side, "RIGHT");
  assertEquals(payload.body.startsWith("<!-- marker -->"), true);
});

Deno.test("a rejected anchor skips one finding; a rate limit stops the phase", async () => {
  for (
    const [status, expected] of [[422, "rejected"], [429, "stop"], [
      500,
      "stop",
    ], [403, "stop"]] as const
  ) {
    const { fetch } = fake([[
      "/pulls/7/comments",
      () => json({ message: "no" }, status),
    ]]);
    assertEquals(
      await openThread(CONTEXT, fetch, "sha", "a.ts", 1, "body"),
      expected,
    );
  }
});

Deno.test("a reply is posted against the thread's root comment", async () => {
  const { fetch, calls } = fake([["/comments/42/replies", () => json({})]]);
  assertEquals(await replyToThread(CONTEXT, fetch, 42, "done"), "created");
  assertEquals(
    calls[0].url,
    "https://api.github.com/repos/zuke-build/zuke/pulls/7/comments/42/replies",
  );
  assertEquals(JSON.parse(calls[0].body).body, "done");
});

Deno.test("the head SHA comes from the pull request itself", async () => {
  const { fetch } = fake([["/pulls/7", () => json({ head: { sha: "abc" } })]]);
  assertEquals(await headSha(CONTEXT, fetch), "abc");
});

/** A GraphQL reviewThreads page. */
function threadPage(
  nodes: Array<{ id: string; root: number }>,
  hasNextPage = false,
): Response {
  return json({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: nodes.map((n) => ({
              id: n.id,
              comments: { nodes: [{ databaseId: n.root }] },
            })),
            pageInfo: { hasNextPage, endCursor: "cur" },
          },
        },
      },
    },
  });
}

Deno.test("resolving joins the thread node id to the root comment id", async () => {
  const { fetch, calls } = fake([[
    "/graphql",
    () => {
      const done = calls.filter((c) => c.url.includes("/graphql")).length > 1;
      return done ? json({ data: { resolveReviewThread: {} } }) : threadPage([
        { id: "NODE_A", root: 42 },
        { id: "NODE_B", root: 99 },
      ]);
    },
  ]]);
  assertEquals(await setThreadsResolved(CONTEXT, fetch, [42], true), 1);
  const graph = calls.filter((c) => c.url.includes("/graphql"));
  // One query for the whole join, then one mutation per thread.
  assertEquals(graph.length, 2);
  assertEquals(graph[0].body.includes("reviewThreads"), true);
  const mutation = JSON.parse(graph[1].body);
  assertEquals(mutation.query.includes("resolveReviewThread"), true);
  // The mutation must carry the THREAD node id, not the REST comment id.
  assertEquals(mutation.variables.id, "NODE_A");
});

Deno.test("unresolving uses the unresolve mutation", async () => {
  const { fetch, calls } = fake([[
    "/graphql",
    () => {
      const done = calls.filter((c) => c.url.includes("/graphql")).length > 1;
      return done ? json({ data: {} }) : threadPage([{ id: "N", root: 7 }]);
    },
  ]]);
  await setThreadsResolved(CONTEXT, fetch, [7], false);
  const graph = calls.filter((c) => c.url.includes("/graphql"));
  assertEquals(
    JSON.parse(graph[1].body).query.includes("unresolveReviewThread"),
    true,
  );
});

Deno.test("the node-id query is paged by cursor", async () => {
  let page = 0;
  const { fetch, calls } = fake([[
    "/graphql",
    () => {
      if (calls.filter((c) => c.url.includes("/graphql")).length > 2) {
        return json({ data: {} });
      }
      page++;
      return page === 1
        ? threadPage([{ id: "N1", root: 1 }], true)
        : threadPage([{ id: "N2", root: 2 }]);
    },
  ]]);
  assertEquals(await setThreadsResolved(CONTEXT, fetch, [2], true), 1);
  const graph = calls.filter((c) => c.url.includes("/graphql"));
  assertEquals(JSON.parse(graph[1].body).variables.cursor, "cur");
});

Deno.test("a GraphQL failure resolves nothing and throws nothing", async () => {
  const failures: Array<() => Response> = [
    // GraphQL reports errors in a 200 — checking `ok` alone reads this as
    // success and the reviewer would believe it resolved the thread.
    () => json({ data: null, errors: [{ message: "Forbidden" }] }),
    () => json({ message: "forbidden" }, 403),
    () => json({}),
  ];
  for (const respond of failures) {
    const { fetch } = fake([["/graphql", respond]]);
    assertEquals(await setThreadsResolved(CONTEXT, fetch, [42], true), 0);
  }
});

Deno.test("resolving nothing issues no GraphQL call at all", async () => {
  const { fetch, calls } = fake([["/graphql", () => json({})]]);
  assertEquals(await setThreadsResolved(CONTEXT, fetch, [], true), 0);
  assertEquals(calls.length, 0);
});

Deno.test("githubHost exposes review threads only inside a pull request", () => {
  assertEquals(githubHost.reviewThreads?.("tkn", env({})), undefined);
  assertEquals(
    typeof githubHost.reviewThreads?.(
      "tkn",
      env({
        GITHUB_REPOSITORY: "zuke-build/zuke",
        GITHUB_REF: "refs/pull/7/merge",
      }),
    ),
    "object",
  );
});

Deno.test("a malformed comment in a listing is skipped, not fatal", async () => {
  const { fetch } = fake([[
    "/pulls/7/comments",
    () =>
      json([
        { id: "not-a-number", body: "bad" },
        { id: 2, body: 42 },
        { id: 3, body: "good", user: { type: "Bot" } },
      ]),
  ]]);
  const listing = await listReviewComments(CONTEXT, fetch);
  assertEquals(listing.comments.map((c) => c.id), [3]);
});

Deno.test("a node-id page without a cursor ends the walk", async () => {
  const { fetch, calls } = fake([[
    "/graphql",
    () => {
      const seen = calls.filter((c) => c.url.includes("/graphql")).length;
      if (seen > 1) return json({ data: {} });
      // hasNextPage true but no usable cursor: stop rather than loop.
      return json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{ id: "N", comments: { nodes: [{ databaseId: 5 }] } }],
                pageInfo: { hasNextPage: true, endCursor: null },
              },
            },
          },
        },
      });
    },
  ]]);
  assertEquals(await setThreadsResolved(CONTEXT, fetch, [5], true), 1);
});

Deno.test("a thread with no known node id is skipped", async () => {
  const { fetch } = fake([[
    "/graphql",
    () => threadPage([{ id: "N", root: 1 }]),
  ]]);
  // Root 42 is not in the join, so there is nothing to resolve.
  assertEquals(await setThreadsResolved(CONTEXT, fetch, [42], true), 0);
});
