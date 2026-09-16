// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for ensuring a release exists. The requests go through a `fetch`
 * seam answering the way the REST API does, so what is asserted is the real
 * two-step flow — look the tag's release up, and POST only when there is none.
 *
 * The behaviours worth pinning are the ones a pipeline running this on every
 * push depends on: that an existing release is never written over, and that
 * the "Latest release" pointer moves only when the caller asked.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { GhApiError, type GhReleaseEnsureSettings, GhTasks } from "../mod.ts";

/** A recorded request the fake `fetch` saw. */
interface Seen {
  url: string;
  method: string;
  authorization: string;
  body: string | undefined;
}

/** A fake GitHub parameterized on what the tag lookup answers. */
function fakeGithub(
  seen: Seen[],
  options: { tagStatus?: number } = {},
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    seen.push({
      url,
      method,
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    await Promise.resolve();
    const respond = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        statusText: status < 300 ? "OK" : "Nope",
      });
    if (method === "POST") {
      return respond(201, {
        id: 42,
        html_url: "https://github.com/acme/app/releases/tag/v1",
      });
    }
    const status = options.tagStatus ?? 200;
    return respond(
      status,
      status < 300
        ? { id: 7, html_url: "https://github.com/acme/app/releases/tag/v1" }
        : { message: "Not Found" },
    );
  };
}

Deno.test("a tag with no release gets one, and the notes go with it", async () => {
  const seen: Seen[] = [];
  const result = await GhTasks.ensureRelease((s) =>
    s
      .tag("v1.0.6")
      .name("Zuke Build v1.0.6")
      .body("Updates something.")
      .repo("acme/app")
      .token("tok")
      .fetch(fakeGithub(seen, { tagStatus: 404 }))
  );

  assertEquals(result.state, "created");
  assertEquals(result.releaseId, 42);
  assertEquals(seen.map((r) => r.method), ["GET", "POST"]);
  assertEquals(
    seen[0].url,
    "https://api.github.com/repos/acme/app/releases/tags/v1.0.6",
  );
  assertEquals(seen[1].url, "https://api.github.com/repos/acme/app/releases");
  assertEquals(seen[1].authorization, "Bearer tok");
  assertEquals(JSON.parse(seen[1].body ?? "{}").tag_name, "v1.0.6");
  assertEquals(JSON.parse(seen[1].body ?? "{}").name, "Zuke Build v1.0.6");
  assertEquals(JSON.parse(seen[1].body ?? "{}").body, "Updates something.");
});

Deno.test("a tag that already has a release is left exactly as it is", async () => {
  // The whole reason this is safe to run on every push. A maintainer's
  // hand-written notes are better than generated ones, and re-publishing over
  // them would replace them with a worse version on the next run — silently,
  // because the release would still be there.
  const seen: Seen[] = [];
  const result = await GhTasks.ensureRelease((s) =>
    s
      .tag("v1.0.5")
      .name("Zuke Build v1.0.5")
      .body("generated notes nobody asked for")
      .repo("acme/app")
      .token("tok")
      .fetch(fakeGithub(seen))
  );

  assertEquals(result.state, "exists");
  assertEquals(result.releaseId, 7);
  // One read, no write.
  assertEquals(seen.map((r) => r.method), ["GET"]);
});

Deno.test("the latest pointer moves only when the caller asked", async () => {
  // GitHub's own default is the other way round: a new release becomes latest
  // unless told otherwise. Back-filling a backlog creates releases
  // oldest-first, so taking that default would walk the pointer backwards and
  // leave it on the oldest release of the run.
  const quiet: Seen[] = [];
  await GhTasks.ensureRelease((s) =>
    s.tag("v1.0.4").name("n").body("b").repo("acme/app").token("tok")
      .fetch(fakeGithub(quiet, { tagStatus: 404 }))
  );
  assertEquals(JSON.parse(quiet[1].body ?? "{}").make_latest, "false");

  const loud: Seen[] = [];
  await GhTasks.ensureRelease((s) =>
    s.tag("v1.0.5").name("n").body("b").repo("acme/app").token("tok")
      .latest()
      .fetch(fakeGithub(loud, { tagStatus: 404 }))
  );
  // A string enum in the REST API, not a boolean.
  assertEquals(JSON.parse(loud[1].body ?? "{}").make_latest, "true");
});

Deno.test("each required setter is named when it is the missing one", async () => {
  // Three guards rather than one covering all three, so the message names the
  // setter the caller actually forgot.
  const cases: [
    (s: GhReleaseEnsureSettings) => GhReleaseEnsureSettings,
    string,
  ][] = [
    [(s) => s, ".tag(...)"],
    [(s) => s.tag("v1.0.6"), ".name(...)"],
    [(s) => s.tag("v1.0.6").name("Zuke Build v1.0.6"), ".body(...)"],
  ];
  for (const [configure, expected] of cases) {
    const error = await assertRejects(() => GhTasks.ensureRelease(configure));
    assertStringIncludes(error.message, expected);
  }
});

Deno.test("an empty body is a release with no notes, not a missing setter", async () => {
  // `.body("")` is a deliberate choice and has to be distinguishable from
  // never calling it — an `?? ""` fallback would make the guard unreachable
  // and the empty case untestable.
  const seen: Seen[] = [];
  const result = await GhTasks.ensureRelease((s) =>
    s.tag("v1.0.6").name("n").body("").repo("acme/app").token("tok")
      .fetch(fakeGithub(seen, { tagStatus: 404 }))
  );
  assertEquals(result.state, "created");
  assertEquals(JSON.parse(seen[1].body ?? "{}").body, "");
});

Deno.test("a tag name that would redirect the request is refused", async () => {
  // The tag is interpolated into a request path with the token attached, so a
  // `..` in it would send the call somewhere else entirely.
  const error = await assertRejects(() =>
    GhTasks.ensureRelease((s) =>
      s.tag("../../secrets").name("n").body("b").repo("acme/app").token("tok")
    )
  );
  assertStringIncludes(error.message, "not a valid git ref name");
});

Deno.test("a lookup failure that is not a 404 is not mistaken for absence", async () => {
  // A 403 from a token missing `contents: write`, or a 500, must not read as
  // "no release yet" — that would turn a permissions problem into a POST that
  // fails second, reporting the wrong cause.
  const seen: Seen[] = [];
  const error = await assertRejects(
    () =>
      GhTasks.ensureRelease((s) =>
        s.tag("v1.0.6").name("n").body("b").repo("acme/app").token("tok")
          .fetch(fakeGithub(seen, { tagStatus: 403 }))
      ),
    GhApiError,
    "failed: 403",
  );
  assertStringIncludes(error.message, "/releases/tags/v1.0.6");
  // Nothing was written after the failed read.
  assertEquals(seen.map((r) => r.method), ["GET"]);
});

Deno.test("the repository and token fall back to the Actions environment", async () => {
  await withEnv(
    { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined },
    async () => {
      const noRepo = await assertRejects(() =>
        GhTasks.ensureRelease((s) => s.tag("v1.0.6").name("n").body("b"))
      );
      assertStringIncludes(noRepo.message, "GITHUB_REPOSITORY");

      const noToken = await assertRejects(() =>
        GhTasks.ensureRelease((s) =>
          s.tag("v1.0.6").name("n").body("b").repo("acme/app")
        )
      );
      // Names the permission, because a 403 from GitHub names the endpoint
      // rather than the scope the token was missing.
      assertStringIncludes(noToken.message, "contents: write");
    },
  );

  const seen: Seen[] = [];
  await withEnv(
    { GITHUB_TOKEN: "ghs_env", GITHUB_REPOSITORY: "acme/app" },
    async () => {
      await GhTasks.ensureRelease((s) =>
        s.tag("v1.0.6").name("n").body("b")
          .fetch(fakeGithub(seen, { tagStatus: 404 }))
      );
    },
  );
  assertEquals(seen[1].authorization, "Bearer ghs_env");
  assertEquals(seen[1].url, "https://api.github.com/repos/acme/app/releases");
});

Deno.test("an enterprise base URL is used, with its trailing slash trimmed", async () => {
  // Same seam as the sibling REST operations. A trailing slash would otherwise
  // produce a double slash in the path, which GitHub Enterprise answers with a
  // 404 that names nothing useful.
  const seen: Seen[] = [];
  await GhTasks.ensureRelease((s) =>
    s.tag("v1.0.6").name("n").body("b").repo("acme/app").token("tok")
      .baseUrl("https://ghes.example/api/v3/")
      .fetch(fakeGithub(seen, { tagStatus: 404 }))
  );
  assertEquals(
    seen[1].url,
    "https://ghes.example/api/v3/repos/acme/app/releases",
  );
});
