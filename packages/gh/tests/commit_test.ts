// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `src/commit.ts` — committing through GitHub's API so no git
 * credential is ever written to disk.
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
import { commitFiles, tagCommit } from "../src/commit.ts";

/** Run `fn` with `values` in the environment, restoring the originals after. */
async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Deno.env.get(name));
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

/** One recorded request. */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
  auth: string | null;
}

/** A fake transport that records calls and answers from a canned table. */
function fakeFetch(
  replies: Record<string, unknown>,
  failing: Set<string> = new Set(),
  statuses: Record<string, number> = {},
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace(
      "https://api.github.com/repos/acme/app",
      "",
    );
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path,
      body: init?.body === undefined
        ? {}
        : JSON.parse(String(init.body)) as Record<string, unknown>,
      auth: headers.get("authorization"),
    });
    const key = `${method} ${path}`;
    if (failing.has(key)) {
      const status = statuses[key] ?? 422;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: status === 403
              ? "Resource not accessible by integration"
              : "Reference does not exist",
          }),
          { status },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(replies[key] ?? {}), { status: 200 }),
    );
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("a commit is a tree and a commit, then the ref moves", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /git/ref/heads/topic": { object: { sha: "head" } },
    "GET /git/commits/head": { tree: { sha: "head-tree" } },
    "POST /git/trees": { sha: "new-tree" },
    "POST /git/commits": { sha: "new-commit" },
    "PATCH /git/refs/heads/topic": {},
  });
  const result = await commitFiles((s) =>
    s
      .repo("acme/app")
      .token("t0ken")
      .branch("topic")
      .message("fix: tidy")
      .file("a.ts", "1\n")
      .fetch(fetch)
  );
  assertEquals(result.sha, "new-commit");

  // Contents ride inline in the tree: no blob to create, nothing orphaned if a
  // later call fails.
  const tree = calls.find((c) => c.path === "/git/trees");
  assertEquals(tree?.body.base_tree, "head-tree");
  assertEquals(
    JSON.stringify(tree?.body.tree),
    JSON.stringify([
      { path: "a.ts", mode: "100644", type: "blob", content: "1\n" },
    ]),
  );

  // The parent is what the branch pointed at, and the update is not forced —
  // so a commit landing in between is rejected rather than overwritten.
  const commit = calls.find((c) =>
    c.path === "/git/commits" && c.method === "POST"
  );
  assertEquals(JSON.stringify(commit?.body.parents), JSON.stringify(["head"]));
  assertEquals(calls.find((c) => c.method === "PATCH")?.body.force, undefined);
});

Deno.test("`.from(...)` creates the branch rather than moving it", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /git/ref/heads/master": { object: { sha: "base" } },
    "GET /git/commits/base": { tree: { sha: "base-tree" } },
    "POST /git/trees": { sha: "t" },
    "POST /git/commits": { sha: "c" },
    "POST /git/refs": {},
  });
  await commitFiles((s) =>
    s
      .repo("acme/app")
      .token("t")
      .from("master")
      .branch("topic")
      .message("chore: x")
      .fetch(fetch)
  );
  // Creating a ref and moving one are different calls, and which is wanted is
  // the caller's to say rather than something to infer.
  const ref = calls.find((c) => c.path === "/git/refs");
  assertEquals(ref?.body.ref, "refs/heads/topic");
  assertEquals(ref?.body.sha, "c");
  assertEquals(calls.some((c) => c.method === "PATCH"), false);
});

Deno.test("the token travels as a header and nothing else", async () => {
  // The whole point: no credential is written anywhere. Reaching a URL or a
  // body would put it in logs and process listings.
  const { fetch, calls } = fakeFetch({
    "GET /git/ref/heads/topic": { object: { sha: "h" } },
    "GET /git/commits/h": { tree: { sha: "t" } },
    "POST /git/trees": { sha: "t2" },
    "POST /git/commits": { sha: "c" },
    "PATCH /git/refs/heads/topic": {},
  });
  await commitFiles((s) =>
    s.repo("acme/app").token("t0ken").branch("topic").message("m").fetch(fetch)
  );
  for (const call of calls) {
    assertEquals(call.auth, "Bearer t0ken");
    assertEquals(call.path.includes("t0ken"), false);
    assertEquals(JSON.stringify(call.body).includes("t0ken"), false);
  }
});

Deno.test("a failure carries GitHub's own message, not just a status", async () => {
  // A status alone rarely says which field or which permission was the
  // problem, and this runs unattended — the log is all anyone will have.
  const { fetch } = fakeFetch({}, new Set(["GET /git/ref/heads/topic"]));
  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/app").token("t").branch("topic").message("m").fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "422");
  assertStringIncludes(message, "Reference does not exist");
});

Deno.test("a ref name that would redirect the request is refused", async () => {
  // URL normalisation resolves `..` before the request is sent, so this branch
  // name turns `/repos/acme/app/git/ref/heads/<branch>` into
  // `/repos/acme/app/user/repos` — a different endpoint entirely, with the
  // write-scoped token attached.
  const traversal = "../../../user/repos";
  assertEquals(
    new URL(`https://api.github.com/repos/acme/app/git/ref/heads/${traversal}`)
      .pathname,
    "/repos/acme/app/user/repos",
  );

  const { fetch, calls } = fakeFetch({});
  for (
    const attempt of [
      () =>
        commitFiles((s) =>
          s.repo("acme/app").token("t").branch(traversal).message("m").fetch(
            fetch,
          )
        ),
      () =>
        commitFiles((s) =>
          s.repo("acme/app").token("t").from(traversal).branch("ok").message(
            "m",
          )
            .fetch(fetch)
        ),
      () =>
        tagCommit((s) =>
          s.repo("acme/app").token("t").name(traversal).commit("c").fetch(fetch)
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

Deno.test("the other names git rejects are rejected too", async () => {
  const { fetch } = fakeFetch({});
  for (
    const name of [
      "",
      "-leading-dash",
      "has space",
      "has~tilde",
      "has^caret",
      "has:colon",
      "has?question",
      "has*star",
      "has[bracket",
      "trailing/",
      "/leading",
      "ends.lock",
      "ends.",
    ]
  ) {
    let threw = false;
    try {
      await commitFiles((s) =>
        s.repo("acme/app").token("t").branch(name).message("m").fetch(fetch)
      );
    } catch {
      threw = true;
    }
    assertEquals(threw, true, `${JSON.stringify(name)} was accepted`);
  }
});

Deno.test("a tag is annotated, and `.move()` forces the update", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /git/tags": { sha: "obj" },
    "POST /git/refs": {},
  });
  await tagCommit((s) =>
    s.repo("acme/app").token("t").name("v1.0.3").commit("c").message("msg")
      .fetch(fetch)
  );
  // Annotated: the tag object carries the message, the ref points at it.
  assertEquals(calls[0].path, "/git/tags");
  assertEquals(calls[0].body.type, "commit");
  assertEquals(calls[1].body.ref, "refs/tags/v1.0.3");

  const moved = fakeFetch({
    "POST /git/tags": { sha: "obj2" },
    "PATCH /git/refs/tags/v1": {},
  });
  await tagCommit((s) =>
    s.repo("acme/app").token("t").name("v1").commit("c").move().fetch(
      moved.fetch,
    )
  );
  // Pointing a major tag at a newer release is a non-fast-forward by
  // definition, so the update has to force.
  assertEquals(moved.calls.find((c) => c.method === "PATCH")?.body.force, true);
});

Deno.test("moving a tag that does not exist yet creates it", async () => {
  // The first release of a major has no ref to patch, and that is not an error
  // — moving and creating are the same intent there.
  const { fetch, calls } = fakeFetch(
    { "POST /git/tags": { sha: "obj" }, "POST /git/refs": {} },
    new Set(["PATCH /git/refs/tags/v2"]),
  );
  await tagCommit((s) =>
    s.repo("acme/app").token("t").name("v2").commit("c").move().fetch(fetch)
  );
  assertEquals(
    calls.find((c) => c.path === "/git/refs")?.body.ref,
    "refs/tags/v2",
  );
});

Deno.test("a permission failure while moving a tag is not retried as a create", async () => {
  // The recovery below exists for one case: the ref does not exist yet. A bare
  // catch would also swallow an expired token or a missing permission and retry
  // it as a create — reporting a confusing error about the tag while hiding the
  // one that actually mattered. In a release path that runs unattended, that is
  // the difference between "fix your token" and a wild goose chase.
  const { fetch, calls } = fakeFetch(
    { "POST /git/tags": { sha: "obj" } },
    new Set(["PATCH /git/refs/tags/v1"]),
    { "PATCH /git/refs/tags/v1": 403 },
  );
  let message = "";
  try {
    await tagCommit((s) =>
      s.repo("acme/app").token("t").name("v1").commit("c").move().fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "403");
  assertStringIncludes(message, "not accessible");
  // And it did not go on to create the ref.
  assertEquals(calls.some((c) => c.path === "/git/refs"), false);
});

Deno.test("a percent-encoded dot segment cannot redirect the request", async () => {
  // The hole the literal `..` test missed. `%` is legal in a git ref, so the
  // validator accepts `%2e%2e` — and the URL parser decodes it to a double-dot
  // segment and resolves it, which is the very redirection the validator exists
  // to prevent. Encoding each segment is what actually closes it; the validator
  // stays for the clearer error on names git itself would refuse.
  const encoded = "%2e%2e/%2e%2e/%2e%2e/user/repos";
  assertEquals(
    new URL(`https://api.github.com/repos/acme/app/git/ref/heads/${encoded}`)
      .pathname,
    // Out of the ref path entirely: three segments up lands beside it.
    "/repos/acme/app/user/repos",
  );

  const seen: string[] = [];
  const capture = ((url: string | URL | Request) => {
    seen.push(new URL(String(url)).pathname);
    return Promise.resolve(
      new Response(
        JSON.stringify({ object: { sha: "a" }, tree: { sha: "t" }, sha: "c" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  await commitFiles((s) =>
    s.repo("acme/app").token("t").branch(encoded).message("m").fetch(capture)
  );
  // Every request stayed under the repository it named.
  for (const path of seen) {
    assertEquals(
      path.startsWith("/repos/acme/app/"),
      true,
      `escaped the repository: ${path}`,
    );
  }
});

Deno.test("a slash inside a branch name stays a path separator", async () => {
  // Encoding wholesale would turn `chore/action-v1.0.3` into one escaped blob
  // and break every real branch name this repository generates.
  const seen: string[] = [];
  const capture = ((url: string | URL | Request) => {
    seen.push(new URL(String(url)).pathname);
    return Promise.resolve(
      new Response(
        JSON.stringify({ object: { sha: "a" }, tree: { sha: "t" }, sha: "c" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  await commitFiles((s) =>
    s.repo("acme/app").token("t").branch("chore/action-v1.0.3").message("m")
      .fetch(capture)
  );
  assertEquals(seen[0], "/repos/acme/app/git/ref/heads/chore/action-v1.0.3");
});

Deno.test("a percent-escaped slug is refused rather than relied on to encode", async () => {
  // This used to assert that `acme/%2e%2e` was encoded to `%252e%252e` and so
  // could not climb out of `/repos/`. Encoding does hold, and still runs — but
  // it was the *only* thing standing between a slug and a redirected
  // token-bearing request, and it does not cover a literal `..`, which
  // `encodeURIComponent` leaves alone. A GitHub repository name contains none
  // of these characters, so the slug is now refused outright and the encoding
  // is defence in depth rather than the defence.
  const reject = (() => {
    throw new Error("no request should have been made");
  }) as typeof fetch;

  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/%2e%2e").token("t").branch("main").message("m")
        .fetch(reject)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes('expected "owner/name"'), true, message);
});

Deno.test("a repository slug that is not owner/name is refused", async () => {
  // Two failures, both of which quietly redirect a token-bearing request.
  // A slug with the wrong number of segments names a different endpoint:
  // `a/b/c` builds `/repos/a/b/c/git/trees`. And a `..` segment climbs out of
  // `/repos/` entirely — encoding does not stop that one, because a literal
  // `..` is left alone by `encodeURIComponent` and the URL parser then
  // resolves it.
  const reject = (() => {
    throw new Error("no request should have been made");
  }) as typeof fetch;

  for (
    const slug of [
      "acme",
      "acme/app/extra",
      "/app",
      "acme/",
      "",
      "/",
      "../app",
      "acme/..",
      "./app",
      "acme/ap p",
    ]
  ) {
    let message = "";
    try {
      await commitFiles((s) =>
        s.repo(slug).token("t").branch("main").message("m").fetch(reject)
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertEquals(
      message.includes('expected "owner/name"'),
      true,
      `${JSON.stringify(slug)} should have been refused, got ${message}`,
    );
  }
});

Deno.test("a 2xx that is not JSON names the call rather than the parser", async () => {
  // A proxy or gateway answering instead of GitHub. Bare, this surfaces as a
  // SyntaxError naming no call.
  const gateway = (() =>
    Promise.resolve(
      new Response("<html>gateway timeout</html>", { status: 200 }),
    )) as typeof fetch;

  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/app").token("t").branch("main").message("m").fetch(gateway)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("/git/ref/heads/main"), true, message);
  assertEquals(message.includes("not JSON"), true, message);
  assertEquals(message.includes("gateway timeout"), true, message);
});

Deno.test("a non-JSON body is not mistaken for a missing tag ref", async () => {
  // `tagCommit` creates a tag when the ref is missing. That decision reads a
  // GhApiError's status, so a parse failure must not enter it: doing so would
  // retry an unrelated failure as a create.
  const calls: string[] = [];
  const gateway = ((url: string | URL | Request) => {
    calls.push(new URL(String(url)).pathname);
    return Promise.resolve(new Response("not json at all", { status: 200 }));
  }) as typeof fetch;

  let message = "";
  try {
    await tagCommit((s) =>
      s.repo("acme/app").token("t").name("v1").commit("c").move().fetch(gateway)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("not JSON"), true, message);
  assertEquals(
    calls.some((path) => path.endsWith("/git/refs")),
    false,
    message,
  );
});

Deno.test("`.replace()` resets a branch a previous attempt left behind", async () => {
  // Without this a job that creates the branch and then fails before opening
  // its pull request can never retry: the second run is refused because the
  // ref it wants to create is already there.
  const { fetch, calls } = fakeFetch(
    {
      "GET /git/ref/heads/master": { object: { sha: "base" } },
      "GET /git/commits/base": { tree: { sha: "base-tree" } },
      "POST /git/trees": { sha: "t" },
      "POST /git/commits": { sha: "c" },
    },
    new Set(["POST /git/refs"]),
    { "POST /git/refs": 422 },
  );
  await commitFiles((s) =>
    s.repo("acme/app").token("t").from("master").branch("topic").replace()
      .message("m").fetch(fetch)
  );
  const patch = calls.find((c) => c.method === "PATCH");
  assertEquals(patch?.path, "/git/refs/heads/topic");
  assertEquals(patch?.body.sha, "c");
  // Forced, because resetting onto the base is not a fast-forward.
  assertEquals(patch?.body.force, true);
});

Deno.test("without `.replace()` an existing branch is still refused", async () => {
  // Discarding commits on a branch that already exists is exactly what should
  // not happen by default.
  const { fetch, calls } = fakeFetch(
    {
      "GET /git/ref/heads/master": { object: { sha: "base" } },
      "GET /git/commits/base": { tree: { sha: "base-tree" } },
      "POST /git/trees": { sha: "t" },
      "POST /git/commits": { sha: "c" },
    },
    new Set(["POST /git/refs"]),
    { "POST /git/refs": 422 },
  );
  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/app").token("t").from("master").branch("topic").message("m")
        .fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "422");
  assertEquals(calls.some((c) => c.method === "PATCH"), false);
});

Deno.test("`.replace()` does not turn a permission failure into a force push", async () => {
  // A bare catch here would retry a 403 as a force-update and report whichever
  // of the two failed second.
  const { fetch, calls } = fakeFetch(
    {
      "GET /git/ref/heads/master": { object: { sha: "base" } },
      "GET /git/commits/base": { tree: { sha: "base-tree" } },
      "POST /git/trees": { sha: "t" },
      "POST /git/commits": { sha: "c" },
    },
    new Set(["POST /git/refs"]),
    { "POST /git/refs": 403 },
  );
  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/app").token("t").from("master").branch("topic").replace()
        .message("m").fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "403");
  assertEquals(calls.some((c) => c.method === "PATCH"), false);
});

Deno.test("`.replace()` without `.from(...)` is refused rather than ignored", async () => {
  // Silently ignoring it would be the worst of both: the caller asked for a
  // reset, the safe path runs instead, and nothing says so.
  const { fetch, calls } = fakeFetch({});
  let message = "";
  try {
    await commitFiles((s) =>
      s.repo("acme/app").token("t").branch("topic").replace().message("m")
        .fetch(fetch)
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, ".replace() only applies together with .from(");
  assertEquals(calls.length, 0);
});

Deno.test("a commit falls back to GITHUB_REPOSITORY and GITHUB_TOKEN", async () => {
  // A job that already has the Actions environment needs to name only what it
  // is committing.
  await withEnv({
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_TOKEN: "ghs_env",
  }, async () => {
    const { fetch, calls } = fakeFetch({
      "GET /git/ref/heads/topic": { object: { sha: "h" } },
      "GET /git/commits/h": { tree: { sha: "t" } },
      "POST /git/trees": { sha: "t2" },
      "POST /git/commits": { sha: "c" },
      "PATCH /git/refs/heads/topic": {},
    });
    const result = await commitFiles((s) =>
      s.branch("topic").message("m").file("a.ts", "1\n").fetch(fetch)
    );
    assertEquals(result.sha, "c");
    // The env-resolved slug routed the request, and the env token rode as the
    // bearer header on every call — never through argv or a body.
    assertEquals(calls[0].path, "/git/ref/heads/topic");
    for (const call of calls) assertEquals(call.auth, "Bearer ghs_env");
  });
});

Deno.test("a tag falls back to GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_SHA", async () => {
  await withEnv({
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_TOKEN: "ghs_env",
    GITHUB_SHA: "e".repeat(40),
  }, async () => {
    const { fetch, calls } = fakeFetch({
      "POST /git/tags": { sha: "obj" },
      "POST /git/refs": {},
    });
    await tagCommit((s) => s.name("v9.9.9").fetch(fetch));
    // The tag points at the commit the workflow ran for.
    assertEquals(calls[0].path, "/git/tags");
    assertEquals(calls[0].body.object, "e".repeat(40));
    for (const call of calls) assertEquals(call.auth, "Bearer ghs_env");
  });
});

Deno.test("a missing repo, token, or sha is named rather than guessed", async () => {
  // Without the Actions environment the settings must say which setting is
  // missing and which variable would have filled it — not fail downstream.
  await withEnv({
    GITHUB_REPOSITORY: undefined,
    GITHUB_TOKEN: undefined,
    GITHUB_SHA: undefined,
  }, async () => {
    const { fetch, calls } = fakeFetch({});
    await assertRejects(
      () =>
        commitFiles((s) => s.token("t").branch("b").message("m").fetch(fetch)),
      Error,
      "committing requires .repo('owner/name') (or GITHUB_REPOSITORY)",
    );
    await assertRejects(
      () =>
        commitFiles((s) =>
          s.repo("acme/app").branch("b").message("m").fetch(fetch)
        ),
      Error,
      "committing requires .token(...) (or GITHUB_TOKEN)",
    );
    await assertRejects(
      () => tagCommit((s) => s.token("t").name("v1").commit("c").fetch(fetch)),
      Error,
      "tagging requires .repo('owner/name') (or GITHUB_REPOSITORY)",
    );
    await assertRejects(
      () =>
        tagCommit((s) =>
          s.repo("acme/app").name("v1").commit("c").fetch(fetch)
        ),
      Error,
      "tagging requires .token(...) (or GITHUB_TOKEN)",
    );
    await assertRejects(
      () =>
        tagCommit((s) => s.repo("acme/app").token("t").name("v1").fetch(fetch)),
      Error,
      "tagging requires .commit(...) (or GITHUB_SHA)",
    );
    // Every refusal happened before anything was sent.
    assertEquals(calls.length, 0);
  });
});

Deno.test("the required commit and tag settings are named when absent", async () => {
  // A bare call is legal to write, so its first missing setting must be named
  // — and refused before the environment or the transport is consulted.
  await assertRejects(
    () => commitFiles(),
    Error,
    "committing requires .branch(...)",
  );
  await assertRejects(
    () => commitFiles((s) => s.repo("acme/app").token("t").branch("topic")),
    Error,
    "committing requires .message(...)",
  );
  await assertRejects(() => tagCommit(), Error, "tagging requires .name(...)");
});

Deno.test("baseUrl retargets commits and tags at a GHES host", async () => {
  const seen: string[] = [];
  const capture: typeof fetch = (input) => {
    seen.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify({ object: { sha: "a" }, tree: { sha: "t" }, sha: "c" }),
        { status: 200 },
      ),
    );
  };
  await commitFiles((s) =>
    s.repo("acme/app").token("t").branch("main").message("m")
      .baseUrl("https://ghe.example.com/api/v3/").fetch(capture)
  );
  // The trailing slash is trimmed, so no `//` appears in the request path.
  assertEquals(
    seen[0],
    "https://ghe.example.com/api/v3/repos/acme/app/git/ref/heads/main",
  );

  seen.length = 0;
  await tagCommit((s) =>
    s.repo("acme/app").token("t").name("v1").commit("c")
      .baseUrl("https://ghe.example.com/api/v3").fetch(capture)
  );
  assertEquals(
    seen[0],
    "https://ghe.example.com/api/v3/repos/acme/app/git/tags",
  );
});

Deno.test("a response missing the field a call needs names that call", async () => {
  // `readString` names the call whose response was malformed, rather than
  // letting `undefined` flow into the next request's path.
  const notRecord = fakeFetch({
    "GET /git/ref/heads/topic": { object: "nope" },
  });
  await assertRejects(
    () =>
      commitFiles((s) =>
        s.repo("acme/app").token("t").branch("topic").message("m")
          .fetch(notRecord.fetch)
      ),
    Error,
    "the ref response has no object.sha",
  );

  // The terminal value has to be a string, not merely present.
  const wrongType = fakeFetch({
    "GET /git/ref/heads/topic": { object: { sha: "h" } },
    "GET /git/commits/h": { tree: { sha: "t" } },
    "POST /git/trees": { sha: 42 },
  });
  await assertRejects(
    () =>
      commitFiles((s) =>
        s.repo("acme/app").token("t").branch("topic").message("m")
          .fetch(wrongType.fetch)
      ),
    Error,
    "the tree response has no sha",
  );
});

Deno.test("an empty 2xx body reads as an empty object, not a parse error", async () => {
  // GitHub answers some writes with an empty body; the transport must not die
  // parsing "" on a reply the caller never reads.
  const empty: typeof fetch = (input, init) => {
    if ((init?.method ?? "GET") === "PATCH") {
      return Promise.resolve(new Response("", { status: 200 }));
    }
    void input;
    return Promise.resolve(
      new Response(
        JSON.stringify({ object: { sha: "a" }, tree: { sha: "t" }, sha: "c" }),
        { status: 200 },
      ),
    );
  };
  const result = await commitFiles((s) =>
    s.repo("acme/app").token("t").branch("main").message("m").fetch(empty)
  );
  assertEquals(result.sha, "c");
});
