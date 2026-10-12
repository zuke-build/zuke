// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `HomebrewTasks.publish`, through a fake GitHub behind the
 * `fetch` seam it hands to `GhTasks.createOrUpdateFile`: created, updated and
 * unchanged formulae, a missing tap, a refused token, and every guard that
 * keeps the write in the tap it names.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { GhApiError } from "@zuke/gh";
import { type HomebrewPublishSettings, HomebrewTasks } from "../mod.ts";

/** A formula source that defines the class for `app`. */
const SOURCE = "class App < Formula\nend\n";

/** The git blob SHA of {@link SOURCE}. */
async function sourceSha(): Promise<string> {
  const body = new TextEncoder().encode(SOURCE);
  const bytes = new Uint8Array([
    ...new TextEncoder().encode(`blob ${body.length}\0`),
    ...body,
  ]);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** One request the fake saw. */
interface Seen {
  method: string;
  url: string;
  authorization: string;
  body: Record<string, unknown>;
}

/** A fake GitHub answering with scripted `[status, payload]` replies. */
function fake(replies: Array<[number, unknown]>): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const impl: typeof fetch = (input, init) => {
    seen.push({
      method: init?.method ?? "GET",
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    });
    const [status, payload] = replies.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  };
  return { fetch: impl, seen };
}

/** The successful PUT answer. */
const WRITTEN: [number, unknown] = [201, {
  commit: { sha: "commit-sha" },
  content: { sha: "blob" },
}];

/** A publish of {@link SOURCE} as `app` to `acme/tap`. */
function publish(
  fetchImpl: typeof fetch,
): (s: HomebrewPublishSettings) => HomebrewPublishSettings {
  return (s) =>
    s.tap("acme/tap").formula("app", SOURCE).token("tap-token")
      .branch("main").message("app 1.2.3").fetch(fetchImpl);
}

Deno.test("publish: a new formula is created as Formula/<name>.rb in homebrew-<tap>", async () => {
  const { fetch, seen } = fake([[404, { message: "Not Found" }], WRITTEN]);
  const result = await HomebrewTasks.publish(publish(fetch));
  assertEquals(result, {
    state: "created",
    repo: "acme/homebrew-tap",
    path: "Formula/app.rb",
    commitSha: "commit-sha",
  });
  assertEquals(
    seen[0].url,
    "https://api.github.com/repos/acme/homebrew-tap/contents/Formula/app.rb?ref=main",
  );
  assertEquals(seen[1].method, "PUT");
  assertEquals(seen[1].body, {
    message: "app 1.2.3",
    content: btoa(SOURCE),
    branch: "main",
  });
  assertEquals(seen[1].authorization, "Bearer tap-token");
});

Deno.test("publish: both tap spellings write to the same repository", async () => {
  for (const tap of ["acme/tap", "acme/homebrew-tap"]) {
    const { fetch, seen } = fake([[404, {}], WRITTEN]);
    const result = await HomebrewTasks.publish((s) =>
      publish(fetch)(s).tap(tap)
    );
    assertEquals(result.repo, "acme/homebrew-tap");
    assertStringIncludes(seen[1].url, "/repos/acme/homebrew-tap/contents/");
  }
});

Deno.test("publish: a changed formula is updated", async () => {
  const { fetch, seen } = fake([[200, { type: "file", sha: "old" }], WRITTEN]);
  const result = await HomebrewTasks.publish(publish(fetch));
  assertEquals(result.state, "updated");
  assertEquals(result.commitSha, "commit-sha");
  assertEquals(seen[1].body.sha, "old");
});

Deno.test("publish: an identical formula makes no commit", async () => {
  const { fetch, seen } = fake([[200, {
    type: "file",
    sha: await sourceSha(),
  }]]);
  const result = await HomebrewTasks.publish(publish(fetch));
  assertEquals(result, {
    state: "unchanged",
    repo: "acme/homebrew-tap",
    path: "Formula/app.rb",
  });
  assertEquals(seen.length, 1);
});

Deno.test("publish: the message defaults, and the default branch is used when none is named", async () => {
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await HomebrewTasks.publish((s) =>
    s.tap("acme/tap").formula("app", SOURCE).token("t").fetch(fetch)
      .baseUrl("https://ghe.example.com/api/v3")
  );
  assertEquals(
    seen[0].url,
    "https://ghe.example.com/api/v3/repos/acme/homebrew-tap/contents/Formula/app.rb",
  );
  assertEquals(seen[1].body.message, "app: update formula");
  assertEquals("branch" in seen[1].body, false);
});

Deno.test("publish: a tap that does not exist fails at the write, naming the status", async () => {
  // The contents API answers 404 for a file in a missing repository too, so
  // the read cannot tell them apart; the write can, and is not swallowed.
  const { fetch } = fake([[404, {}], [404, { message: "Not Found" }]]);
  const error = await assertRejects(
    () => HomebrewTasks.publish(publish(fetch)),
    GhApiError,
    "PUT /contents/Formula/app.rb failed: 404",
  );
  assertEquals(error instanceof GhApiError ? error.status : 0, 404);
});

Deno.test("publish: a refused token fails without the token in the message", async () => {
  const { fetch } = fake([[401, { message: "Bad credentials" }]]);
  const error = await assertRejects(
    () => HomebrewTasks.publish(publish(fetch)),
    GhApiError,
    "401",
  );
  assertEquals(error.message.includes("tap-token"), false);
});

Deno.test("publish: GITHUB_REPOSITORY never redirects the write; GITHUB_TOKEN is the token fallback", async () => {
  const { fetch, seen } = fake([[404, {}], WRITTEN]);
  await withEnv(
    { GITHUB_REPOSITORY: "acme/app", GITHUB_TOKEN: "env-token" },
    async () => {
      await HomebrewTasks.publish((s) =>
        s.tap("acme/tap").formula("app", SOURCE).fetch(fetch)
      );
    },
  );
  assertStringIncludes(seen[0].url, "/repos/acme/homebrew-tap/");
  assertEquals(seen[0].authorization, "Bearer env-token");
});

Deno.test("publish: required settings, and everything that could leave the tap, are refused before any request", async () => {
  const { fetch, seen } = fake([]);
  const cases: Array<
    [(s: HomebrewPublishSettings) => HomebrewPublishSettings, string]
  > = [
    [(s) => s.formula("app", SOURCE).fetch(fetch), "requires .tap("],
    [(s) => s.tap("acme/tap").fetch(fetch), "requires .formula(name, source)"],
    [(s) => publish(fetch)(s).tap("acme/tap/x"), "invalid tap"],
    [(s) => publish(fetch)(s).tap("../tap"), "invalid tap"],
    [
      (s) => publish(fetch)(s).formula("../app", SOURCE),
      "invalid formula name",
    ],
    [
      (s) => publish(fetch)(s).formula("App", SOURCE),
      "invalid formula name",
    ],
    [
      (s) => publish(fetch)(s).formula("other", SOURCE),
      "does not define `class Other < Formula`",
    ],
    [(s) => publish(fetch)(s).branch("../main"), "not a valid git ref name"],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      () => HomebrewTasks.publish(configure),
      Error,
      message,
    );
  }
  assertEquals(seen.length, 0);
});
