import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError } from "../mod.ts";
import {
  type GithubContext,
  resolveGithubContext,
  upsertPrComment,
} from "../src/github.ts";

/** A recorded request. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/**
 * A fake `fetch` for the GitHub API: the GET (list comments) returns `comments`,
 * any write returns `{}`. Both use `status`. Records every call.
 */
function fakeGithub(
  comments: unknown,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "GET" ? JSON.stringify(comments) : "{}";
    return Promise.resolve(new Response(payload, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** A reader over a fixed env map. */
function env(map: Record<string, string>): (key: string) => string | undefined {
  return (key) => map[key];
}

const VALID = {
  GITHUB_REPOSITORY: "zuke-build/zuke",
  GITHUB_REF: "refs/pull/100/merge",
};

const CONTEXT: GithubContext = {
  token: "tkn",
  owner: "zuke-build",
  repo: "zuke",
  pull: 100,
};

Deno.test("resolveGithubContext reads owner/repo and the PR number", () => {
  assertEquals(resolveGithubContext("tkn", env(VALID)), CONTEXT);
});

Deno.test("resolveGithubContext returns undefined when anything is missing", () => {
  // No token.
  assertEquals(resolveGithubContext("", env(VALID)), undefined);
  // No GITHUB_REPOSITORY.
  assertEquals(
    resolveGithubContext("tkn", env({ GITHUB_REF: VALID.GITHUB_REF })),
    undefined,
  );
  // Malformed repository slugs.
  for (const repo of ["noslash", "/repo", "owner/"]) {
    assertEquals(
      resolveGithubContext(
        "tkn",
        env({ GITHUB_REPOSITORY: repo, GITHUB_REF: VALID.GITHUB_REF }),
      ),
      undefined,
    );
  }
  // A non-PR ref (e.g. a branch push) has no pull number.
  assertEquals(
    resolveGithubContext(
      "tkn",
      env({ ...VALID, GITHUB_REF: "refs/heads/master" }),
    ),
    undefined,
  );
});

Deno.test("upsertPrComment creates a new comment when none exists", async () => {
  const { fetch, calls } = fakeGithub([]);
  await upsertPrComment(CONTEXT, "security review", "## body", fetch);

  assertEquals(calls.length, 2); // list, then create
  assertEquals(
    calls[0].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/100/comments?per_page=100",
  );
  assertEquals(calls[1].method, "POST");
  assertEquals(
    calls[1].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/100/comments",
  );
  const body = JSON.parse(calls[1].body);
  assertEquals(
    body.body.includes("<!-- zuke-ai-review:security review -->"),
    true,
  );
  // The comment is attributed to Zuke.
  assertEquals(
    body.body.includes(
      "🤖 **[Zuke](https://github.com/zuke-build/zuke) AI review**",
    ),
    true,
  );
  assertEquals(body.body.includes("## body"), true);
});

Deno.test("upsertPrComment patches the existing comment in place", async () => {
  const existing = [
    { id: 1, body: "unrelated" },
    { id: 7, body: "<!-- zuke-ai-review:security review -->\nold" },
  ];
  const { fetch, calls } = fakeGithub(existing);
  await upsertPrComment(CONTEXT, "security review", "## new", fetch);

  assertEquals(calls[1].method, "PATCH");
  assertEquals(
    calls[1].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/comments/7",
  );
});

Deno.test("upsertPrComment ignores a non-array comment listing", async () => {
  const { fetch, calls } = fakeGithub({ message: "Not Found" });
  await upsertPrComment(CONTEXT, "security review", "## body", fetch);
  assertEquals(calls[1].method, "POST"); // falls back to creating
});

Deno.test("upsertPrComment surfaces a GitHub API error", async () => {
  const { fetch } = fakeGithub([], 403);
  await assertRejects(
    () => upsertPrComment(CONTEXT, "security review", "## body", fetch),
    AiReviewError,
    "GitHub API error: HTTP 403",
  );
});
