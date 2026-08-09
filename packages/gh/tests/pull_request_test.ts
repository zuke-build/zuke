/**
 * Unit tests for `src/pull_request.ts` — proposing a branch through the API so
 * no git credential is ever written to disk.
 *
 * `fetch` is injected via the settings seam, so none of this touches the
 * network.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  type GhPullRequestSettings,
  openPullRequest,
} from "../src/pull_request.ts";

/** One recorded request. */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** A fake transport answering each path from a canned table. */
function fakeFetch(
  replies: Record<string, { status: number; body: unknown }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace("/repos/acme/app", "")}${url.search}`;
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      body: init?.body === undefined
        ? {}
        : JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const reply = replies[`${method} ${path}`] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status }),
    );
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("a pull request is opened from head onto base", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /pulls": {
      status: 201,
      body: { number: 7, html_url: "https://github.com/acme/app/pull/7" },
    },
  });
  const result = await openPullRequest((s) =>
    s
      .repo("acme/app")
      .token("t")
      .head("chore/action-v1.0.3")
      .base("master")
      .title("chore: use the Zuke action at v1.0.3")
      .body("prose")
      .fetch(fetch)
  );
  assertEquals(result.number, 7);
  assertEquals(result.created, true);
  assertEquals(calls[0].body.head, "chore/action-v1.0.3");
  assertEquals(calls[0].body.base, "master");
});

Deno.test("an existing proposal is found rather than failed on", async () => {
  // The retry case. A job that opened this branch and then failed later must be
  // able to run again; without the lookup the second run dies on the 422 and
  // the work is stuck until someone intervenes.
  const { fetch, calls } = fakeFetch({
    "POST /pulls": {
      status: 422,
      body: { message: "A pull request already exists for acme:topic." },
    },
    "GET /pulls?state=open&head=acme%3Atopic": {
      status: 200,
      body: [{ number: 4, html_url: "https://github.com/acme/app/pull/4" }],
    },
  });
  const result = await openPullRequest((s) =>
    s.repo("acme/app").token("t").head("topic").base("master").title("t")
      .fetch(fetch)
  );
  assertEquals(result.number, 4);
  // Reported, not hidden: "proposed" and "already proposed" are different
  // things to whoever reads the log.
  assertEquals(result.created, false);
  assertEquals(calls.length, 2);
});

Deno.test("a 422 with no open pull request keeps the original error", async () => {
  // 422 covers several unrelated problems — a base branch that does not exist,
  // a head with no commits. Reporting "already open" for those would send the
  // reader looking for a pull request that was never there.
  const { fetch } = fakeFetch({
    "POST /pulls": {
      status: 422,
      body: { message: "No commits between master and topic" },
    },
    "GET /pulls?state=open&head=acme%3Atopic": { status: 200, body: [] },
  });
  let message = "";
  try {
    await openPullRequest((s) =>
      s.repo("acme/app").token("t").head("topic").base("master").title("t")
        .fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "No commits between master and topic");
});

Deno.test("a failure that is not a 422 is not treated as an existing one", async () => {
  // A missing permission must not send the caller looking for a pull request:
  // the lookup would fail too, and the reported error would be the second one.
  const { fetch, calls } = fakeFetch({
    "POST /pulls": {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    },
  });
  let message = "";
  try {
    await openPullRequest((s) =>
      s.repo("acme/app").token("t").head("topic").base("master").title("t")
        .fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Resource not accessible by integration");
  assertEquals(calls.length, 1);
});

Deno.test("a branch name that would redirect the request is refused", async () => {
  // Same primitive as the commit operations: these names reach a request path
  // and a query string, and URL normalisation resolves `..` before the request
  // is sent.
  const { fetch, calls } = fakeFetch({});
  for (
    const attempt of [
      () =>
        openPullRequest((s) =>
          s.repo("acme/app").token("t").head("../../../user/repos").base(
            "master",
          ).title("t").fetch(fetch)
        ),
      () =>
        openPullRequest((s) =>
          s.repo("acme/app").token("t").head("topic").base("../../../user")
            .title("t").fetch(fetch)
        ),
    ]
  ) {
    let message = "";
    try {
      await attempt();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertStringIncludes(message, "not a valid git ref name");
  }
  // Refused before anything was sent: a request that goes out and fails has
  // already carried the token somewhere unintended.
  assertEquals(calls.length, 0);
});

Deno.test("the missing settings are named rather than sent empty", async () => {
  const { fetch } = fakeFetch({});
  const cases: [(s: GhPullRequestSettings) => GhPullRequestSettings, string][] =
    [
      [(s) => s.base("master").title("t"), ".head("],
      [(s) => s.head("topic").title("t"), ".base("],
      [(s) => s.head("topic").base("master"), ".title("],
    ];
  for (const [configure, expected] of cases) {
    let message = "";
    try {
      await openPullRequest((s) =>
        configure(s.repo("acme/app").token("t").fetch(fetch))
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertStringIncludes(message, expected);
  }
});
