/**
 * Unit tests for `build/propose_change.ts` — the API path that opens a pull
 * request and moves tags without a git credential ever reaching disk.
 *
 * `fetch` is injected, so none of this touches the network.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { createTag, moveTag, proposeChange } from "../build/propose_change.ts";

/** One recorded request. */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
  auth: string | null;
}

/** A fake transport that records calls and replies from a canned table. */
function fakeFetch(
  replies: Record<string, unknown>,
  failing = new Set<string>(),
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace("https://api.github.com/repos/acme/app", "");
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
  return { fetch: fetchImpl, calls };
}

const BASE = {
  repo: "acme/app",
  token: "t0ken",
  base: "master",
  branch: "chore/action-v1.0.3",
  subject: "chore: use the Zuke action at v1.0.3",
  body: "why",
};

Deno.test("a pull request is built from a tree, a commit and a ref", () => {
  const { fetch, calls } = fakeFetch({
    "GET /git/ref/heads/master": { object: { sha: "base-sha" } },
    "GET /git/commits/base-sha": { tree: { sha: "base-tree" } },
    "POST /git/trees": { sha: "new-tree" },
    "POST /git/commits": { sha: "new-commit" },
    "POST /git/refs": {},
    "POST /pulls": { number: 7, html_url: "https://example.test/7" },
  });
  return proposeChange({
    ...BASE,
    files: [{ path: "a.json", content: "{}\n" }],
    fetch,
  }).then((pull) => {
    assertEquals(pull.number, 7);
    assertEquals(pull.url, "https://example.test/7");

    // The commit is built server-side: file contents ride inline in the tree,
    // so there is no blob to create and nothing to clean up if a later call
    // fails.
    const tree = calls.find((c) => c.path === "/git/trees");
    assertEquals(tree?.body.base_tree, "base-tree");
    assertEquals(
      JSON.stringify(tree?.body.tree),
      JSON.stringify([{
        path: "a.json",
        mode: "100644",
        type: "blob",
        content: "{}\n",
      }]),
    );

    // The branch is a ref pointing at that commit; nothing was pushed.
    const ref = calls.find((c) => c.path === "/git/refs");
    assertEquals(ref?.body.ref, "refs/heads/chore/action-v1.0.3");
    assertEquals(ref?.body.sha, "new-commit");
  });
});

Deno.test("the token travels as a header and nothing else", () => {
  // The whole point of this module: no credential is written anywhere. If it
  // ever reached a URL or a body it would be in logs and process listings.
  const { fetch, calls } = fakeFetch({
    "GET /git/ref/heads/master": { object: { sha: "s" } },
    "GET /git/commits/s": { tree: { sha: "t" } },
    "POST /git/trees": { sha: "t2" },
    "POST /git/commits": { sha: "c" },
    "POST /pulls": { number: 1, html_url: "u" },
  });
  return proposeChange({ ...BASE, files: [], fetch }).then(() => {
    for (const call of calls) {
      assertEquals(call.auth, "Bearer t0ken");
      assertEquals(call.path.includes("t0ken"), false);
      assertEquals(JSON.stringify(call.body).includes("t0ken"), false);
    }
  });
});

Deno.test("a failed call names the status and what GitHub said", () => {
  // A half-created branch is easier to reason about than a silent no-op, so
  // this must throw — and say enough to act on.
  const { fetch } = fakeFetch({}, new Set(["GET /git/ref/heads/master"]));
  return proposeChange({ ...BASE, files: [], fetch })
    .then(() => {
      throw new Error("expected a throw");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assertStringIncludes(message, "422");
      assertStringIncludes(message, "Reference does not exist");
    });
});

Deno.test("a new tag is an annotated object plus a ref", () => {
  const { fetch, calls } = fakeFetch({
    "POST /git/tags": { sha: "tag-object" },
    "POST /git/refs": {},
  });
  return createTag({ repo: "acme/app", token: "t", fetch }, "v1.0.3", "c", "m")
    .then(() => {
      // Annotated rather than lightweight: the tags already published are, and
      // a reader comparing them should not find one that is not.
      assertEquals(calls[0].body.tag, "v1.0.3");
      assertEquals(calls[0].body.object, "c");
      assertEquals(calls[0].body.type, "commit");
      assertEquals(calls[1].body.ref, "refs/tags/v1.0.3");
      assertEquals(calls[1].body.sha, "tag-object");
    });
});

Deno.test("moving a tag forces the update, and creates it when absent", () => {
  // `v1` moving onto a newer release is a non-fast-forward by definition, so
  // the update has to force. And the first release of a major has no ref to
  // patch, which must not be an error.
  const { fetch, calls } = fakeFetch({
    "POST /git/tags": { sha: "obj" },
    "POST /git/refs": {},
  }, new Set(["PATCH /git/refs/tags/v1"]));
  return moveTag({ repo: "acme/app", token: "t", fetch }, "v1", "c", "m")
    .then(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      assertEquals(patch?.body.force, true);
      // The patch failed, so it fell back to creating the ref.
      const create = calls.find((c) => c.path === "/git/refs");
      assertEquals(create?.body.ref, "refs/tags/v1");
    });
});
