// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `GhTasks.createOrUpdateFile`. The requests go through the
 * `fetch` seam, answered the way the contents API answers, so what is asserted
 * is the real flow: read the file's blob SHA, compare it with the new
 * content's, and PUT only when they differ.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { GhApiError, type GhContentsSettings, GhTasks } from "../mod.ts";

/** The git blob SHA of `hello\n` — `git hash-object` on that content. */
const HELLO_SHA = "ce013625030ba8dba906f756967f9e9ca394464a";

/** One request the fake saw. */
interface Seen {
  method: string;
  url: string;
  authorization: string;
  body: Record<string, unknown>;
}

/** A scripted answer: status and JSON payload. */
type Reply = [number, unknown];

/** A fake GitHub answering each request with the next scripted reply. */
function fake(replies: Reply[]): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const queue = [...replies];
  const impl: typeof fetch = (input, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    seen.push({
      method: init?.method ?? "GET",
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body,
    });
    const [status, payload] = queue.shift() ?? [500, { message: "no reply" }];
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status }),
    );
  };
  return { fetch: impl, seen };
}

/** A successful PUT answer. */
const WRITTEN: Reply = [201, {
  commit: { sha: "commit-sha" },
  content: { sha: HELLO_SHA },
}];

/** Configure a write of `hello\n` to `Formula/app.rb` on `acme/tap`. */
function write(
  fetchImpl: typeof fetch,
): (s: GhContentsSettings) => GhContentsSettings {
  return (s) =>
    s.repo("acme/tap").token("tok").path("Formula/app.rb").content("hello\n")
      .message("app 1.2.3").branch("main").fetch(fetchImpl);
}

Deno.test("contents: a missing file is created, with no sha sent", async () => {
  const { fetch, seen } = fake([[404, { message: "Not Found" }], WRITTEN]);
  const result = await GhTasks.createOrUpdateFile(write(fetch));
  assertEquals(result, {
    state: "created",
    path: "Formula/app.rb",
    commitSha: "commit-sha",
    blobSha: HELLO_SHA,
  });
  assertEquals(
    seen[0].url,
    "https://api.github.com/repos/acme/tap/contents/Formula/app.rb?ref=main",
  );
  assertEquals(seen[1].method, "PUT");
  assertEquals(
    seen[1].url,
    "https://api.github.com/repos/acme/tap/contents/Formula/app.rb",
  );
  assertEquals(seen[1].body, {
    message: "app 1.2.3",
    content: btoa("hello\n"),
    branch: "main",
  });
  assertEquals(seen[1].authorization, "Bearer tok");
});

Deno.test("contents: a file with other content is updated against its sha", async () => {
  const { fetch, seen } = fake([
    [200, { type: "file", sha: "old-sha" }],
    WRITTEN,
  ]);
  const result = await GhTasks.createOrUpdateFile(write(fetch));
  assertEquals(result.state, "updated");
  assertEquals(result.commitSha, "commit-sha");
  assertEquals(seen[1].body.sha, "old-sha");
});

Deno.test("contents: identical content writes nothing", async () => {
  const { fetch, seen } = fake([[200, { type: "file", sha: HELLO_SHA }]]);
  const result = await GhTasks.createOrUpdateFile(write(fetch));
  assertEquals(result, {
    state: "unchanged",
    path: "Formula/app.rb",
    blobSha: HELLO_SHA,
  });
  assertEquals(seen.length, 1);
});

Deno.test("contents: UTF-8 content is hashed and encoded as bytes", async () => {
  // `printf 'é\n' | git hash-object --stdin`.
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await GhTasks.createOrUpdateFile((s) => write(fetch)(s).content("é\n"));
  assertEquals(seen[1].body.content, "w6kK");
  const same = fake([[200, {
    type: "file",
    sha: "c6003325155f475bd7c87731607525dce73be9cf",
  }]]);
  const result = await GhTasks.createOrUpdateFile((s) =>
    write(same.fetch)(s).content("é\n")
  );
  assertEquals(result.state, "unchanged");
});

Deno.test("contents: with no branch the default branch is read and written", async () => {
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await GhTasks.createOrUpdateFile((s) =>
    s.repo("acme/tap").token("tok").path("a.txt").content("hello\n")
      .message("m").fetch(fetch)
  );
  assertEquals(
    seen[0].url,
    "https://api.github.com/repos/acme/tap/contents/a.txt",
  );
  assertEquals("branch" in seen[1].body, false);
});

Deno.test("contents: a lost race that wrote the same content is unchanged", async () => {
  const { fetch, seen } = fake([
    [404, {}],
    [422, { message: "sha wasn't supplied" }],
    [200, { type: "file", sha: HELLO_SHA }],
  ]);
  const result = await GhTasks.createOrUpdateFile(write(fetch));
  assertEquals(result.state, "unchanged");
  assertEquals(seen.map((request) => request.method), ["GET", "PUT", "GET"]);
});

Deno.test("contents: a lost race with different content raises the conflict and never writes again", async () => {
  // Finding 2 of the adversarial review: the retry used to PUT over the other
  // writer's newer blob. The second read decides only between "unchanged" and
  // the conflict; it must never lead to a second write.
  for (const status of [409, 422]) {
    const { fetch, seen } = fake([
      [200, { type: "file", sha: "a" }],
      [status, { message: "conflict" }],
      [200, { type: "file", sha: "someone-elses-newer-blob" }],
      WRITTEN,
    ]);
    const error = await assertRejects(
      () => GhTasks.createOrUpdateFile(write(fetch)),
      GhApiError,
    );
    assertEquals(error instanceof GhApiError ? error.status : 0, status);
    assertEquals(seen.map((request) => request.method), ["GET", "PUT", "GET"]);
  }
});

Deno.test("contents: a lost create race whose file vanished again is still a conflict", async () => {
  const { fetch, seen } = fake([
    [404, {}],
    [422, { message: "sha wasn't supplied" }],
    [404, {}],
    WRITTEN,
  ]);
  await assertRejects(
    () => GhTasks.createOrUpdateFile(write(fetch)),
    GhApiError,
    "422",
  );
  assertEquals(seen.filter((request) => request.method === "PUT").length, 1);
});

Deno.test("contents: an auth failure is raised at once and never carries the token", async () => {
  const { fetch, seen } = fake([[401, { message: "Bad credentials" }]]);
  const error = await assertRejects(
    () => GhTasks.createOrUpdateFile(write(fetch)),
    GhApiError,
  );
  assertEquals(error instanceof GhApiError ? error.status : 0, 401);
  assertEquals(error.message.includes("tok"), false);
  assertEquals(seen.length, 1);
  // A forbidden write is not a race either.
  const denied = fake([[404, {}], [403, { message: "denied" }]]);
  const writeError = await assertRejects(
    () => GhTasks.createOrUpdateFile(write(denied.fetch)),
    GhApiError,
  );
  assertEquals(writeError instanceof GhApiError ? writeError.status : 0, 403);
  assertEquals(denied.seen.length, 2);
});

Deno.test("contents: a directory, symlink or submodule at the path is left alone", async () => {
  for (const payload of [[{ type: "file" }], { type: "symlink", sha: "x" }]) {
    const { fetch, seen } = fake([[200, payload]]);
    await assertRejects(
      () => GhTasks.createOrUpdateFile(write(fetch)),
      Error,
      "is not a regular file",
    );
    assertEquals(seen.length, 1);
  }
});

Deno.test("contents: required settings are named when missing", async () => {
  const { fetch } = fake([]);
  const base = (s: GhContentsSettings) =>
    s.repo("acme/tap").token("tok").fetch(fetch);
  await assertRejects(
    () => GhTasks.createOrUpdateFile((s) => base(s).content("x").message("m")),
    Error,
    ".path(...)",
  );
  await assertRejects(
    () => GhTasks.createOrUpdateFile((s) => base(s).path("a").message("m")),
    Error,
    ".content(...)",
  );
  await assertRejects(
    () => GhTasks.createOrUpdateFile((s) => base(s).path("a").content("x")),
    Error,
    ".message(...)",
  );
  await assertRejects(() => GhTasks.createOrUpdateFile(), Error, ".path(...)");
});

Deno.test("contents: a path that could leave the endpoint is refused before any request", async () => {
  const { fetch, seen } = fake([]);
  for (
    const path of [
      "../x",
      "Formula/../../x",
      "/abs",
      "a//b",
      "a/./b",
      "trail/",
      "a\\b",
      "a\nb",
    ]
  ) {
    await assertRejects(
      () => GhTasks.createOrUpdateFile((s) => write(fetch)(s).path(path)),
      Error,
      "refusing to write",
    );
  }
  await assertRejects(
    () => GhTasks.createOrUpdateFile((s) => write(fetch)(s).branch("../main")),
    Error,
    "not a valid git ref name",
  );
  assertEquals(seen.length, 0);
});

Deno.test("contents: a percent sequence in the path stays an ordinary segment", async () => {
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await GhTasks.createOrUpdateFile((s) => write(fetch)(s).path("%2e%2e/x"));
  assertStringIncludes(seen[0].url, "/contents/%252e%252e/x");
  // A query or fragment character cannot cut the path short either.
  const other = fake([[404, {}], WRITTEN]);
  await GhTasks.createOrUpdateFile((s) => write(other.fetch)(s).path("a?b#c"));
  assertStringIncludes(
    other.seen[0].url,
    "/contents/a%3Fb%23c?ref=main",
  );
});

Deno.test("contents: the repository and token fall back to the Actions environment", async () => {
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await withEnv(
    { GITHUB_REPOSITORY: "acme/env", GITHUB_TOKEN: "env-token" },
    async () => {
      await GhTasks.createOrUpdateFile((s) =>
        s.path("a.txt").content("hello\n").message("m").fetch(fetch)
          .baseUrl("https://ghe.example.com/api/v3/")
      );
    },
  );
  assertEquals(
    seen[0].url,
    "https://ghe.example.com/api/v3/repos/acme/env/contents/a.txt",
  );
  assertEquals(seen[0].authorization, "Bearer env-token");
  await withEnv({ GITHUB_TOKEN: undefined }, async () => {
    await assertRejects(
      () =>
        GhTasks.createOrUpdateFile((s) =>
          s.repo("acme/tap").path("a").content("x").message("m")
        ),
      Error,
      "requires .token(...) (or GITHUB_TOKEN) with contents: write.",
    );
  });
});
