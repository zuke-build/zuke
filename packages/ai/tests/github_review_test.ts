import { assertEquals } from "../../core/tests/_assert.ts";
import {
  postSuggestions,
  type Suggestion,
  suggestionMarker,
} from "../src/hosts/github_review.ts";
import type { GithubContext } from "../src/hosts/github.ts";

const CONTEXT: GithubContext = { token: "t", owner: "o", repo: "r", pull: 7 };

interface Call {
  url: string;
  method: string;
  body: string;
}

/** A fake GitHub API: PR detail returns `sha`, comment GET returns `existing`. */
function ghFetch(opts: {
  sha?: string;
  existing?: unknown[];
  postStatus?: number;
}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("/comments")) {
      if (method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify(opts.existing ?? []), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response("{}", { status: opts.postStatus ?? 201 }),
      );
    }
    const detail = opts.sha !== undefined ? { head: { sha: opts.sha } } : {};
    return Promise.resolve(
      new Response(JSON.stringify(detail), { status: 200 }),
    );
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const ONE: Suggestion = {
  path: "zuke.ts",
  line: 45,
  startLine: 42,
  body: "Remove this.\n```suggestion\n```",
  key: "zuke.ts:42",
};

Deno.test("postSuggestions is a no-op for an empty list", async () => {
  const { fetch, calls } = ghFetch({ sha: "abc" });
  assertEquals(await postSuggestions(CONTEXT, [], fetch), 0);
  assertEquals(calls.length, 0);
});

Deno.test("postSuggestions posts a multi-line suggestion anchored to the head sha", async () => {
  const { fetch, calls } = ghFetch({ sha: "abc123", existing: [] });
  const created = await postSuggestions(CONTEXT, [ONE], fetch);
  assertEquals(created, 1);
  const post = calls.find((c) => c.method === "POST");
  if (post === undefined) throw new Error("no POST call");
  const payload = JSON.parse(post.body);
  assertEquals(payload.commit_id, "abc123");
  assertEquals(payload.path, "zuke.ts");
  assertEquals(payload.line, 45);
  assertEquals(payload.start_line, 42);
  assertEquals(payload.start_side, "RIGHT");
  assertEquals(payload.side, "RIGHT");
  assertEquals(String(payload.body).includes("```suggestion"), true);
  assertEquals(
    String(payload.body).includes(suggestionMarker("zuke.ts:42")),
    true,
  );
});

Deno.test("a single-line suggestion omits start_line", async () => {
  const { fetch, calls } = ghFetch({ sha: "abc", existing: [] });
  await postSuggestions(CONTEXT, [{ ...ONE, line: 42, startLine: 42 }], fetch);
  const post = calls.find((c) => c.method === "POST");
  if (post === undefined) throw new Error("no POST call");
  const payload = JSON.parse(post.body);
  assertEquals("start_line" in payload, false);
});

Deno.test("an already-posted suggestion is skipped (matched by key)", async () => {
  const existing = [{ body: `${suggestionMarker("zuke.ts:42")}\nold` }];
  const { fetch, calls } = ghFetch({ sha: "abc", existing });
  const created = await postSuggestions(CONTEXT, [ONE], fetch);
  assertEquals(created, 0);
  assertEquals(calls.some((c) => c.method === "POST"), false);
});

Deno.test("a rejected suggestion (line not in diff) is skipped, not fatal", async () => {
  const { fetch } = ghFetch({ sha: "abc", existing: [], postStatus: 422 });
  assertEquals(await postSuggestions(CONTEXT, [ONE], fetch), 0);
});

Deno.test("no head sha means nothing is posted", async () => {
  const { fetch, calls } = ghFetch({ existing: [] });
  assertEquals(await postSuggestions(CONTEXT, [ONE], fetch), 0);
  assertEquals(calls.some((c) => c.method === "POST"), false);
});
