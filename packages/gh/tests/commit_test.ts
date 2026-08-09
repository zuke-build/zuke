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
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { commitFiles, tagCommit } from "../src/commit.ts";

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
      return Promise.resolve(
        new Response('{"message":"Reference does not exist"}', { status: 422 }),
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
