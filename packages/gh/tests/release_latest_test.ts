// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for marking a release as latest. The requests go through a
 * `fetch` seam answering the way the REST API does, so what is asserted is
 * the real three-step flow — resolve the tag's release, check where the
 * pointer already is, and PATCH only when it must move.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { GhApiError, GhTasks } from "../mod.ts";

/** A recorded request the fake `fetch` saw. */
interface Seen {
  url: string;
  method: string;
  authorization: string;
  body: string | undefined;
}

/** A fake GitHub parameterized on the two lookups' answers. */
function fakeGithub(
  seen: Seen[],
  options: {
    tagStatus?: number;
    tagId?: number;
    latestStatus?: number;
    latestId?: number;
    patchStatus?: number;
  } = {},
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
    if (method === "PATCH") {
      const status = options.patchStatus ?? 200;
      return respond(
        status,
        status < 300 ? { id: options.tagId ?? 7 } : { message: "refused" },
      );
    }
    if (url.includes("/releases/tags/")) {
      const status = options.tagStatus ?? 200;
      return respond(
        status,
        status < 300 ? { id: options.tagId ?? 7 } : { message: "Not Found" },
      );
    }
    const status = options.latestStatus ?? 200;
    return respond(
      status,
      status < 300 ? { id: options.latestId ?? 9 } : { message: "Not Found" },
    );
  };
}

Deno.test("a release that is not latest is marked with a PATCH", async () => {
  const seen: Seen[] = [];
  const result = await GhTasks.markReleaseLatest((s) =>
    s.tag("v1.0.2").repo("acme/app").token("tok").fetch(fakeGithub(seen))
  );

  assertEquals(result, { state: "marked", tag: "v1.0.2", releaseId: 7 });
  // The tag lookup, the pointer check, then the one write.
  assertEquals(seen.map((s) => s.method), ["GET", "GET", "PATCH"]);
  assertStringIncludes(seen[0].url, "/repos/acme/app/releases/tags/v1.0.2");
  assertStringIncludes(seen[1].url, "/repos/acme/app/releases/latest");
  assertStringIncludes(seen[2].url, "/repos/acme/app/releases/7");
  // The REST API wants the string enum, not a boolean — and the token rides
  // in the header, never the URL.
  assertEquals(seen[2].body, '{"make_latest":"true"}');
  assertEquals(seen[2].authorization, "Bearer tok");
});

Deno.test("a release that is already latest is left unwritten", async () => {
  const seen: Seen[] = [];
  const result = await GhTasks.markReleaseLatest((s) =>
    s.tag("v1.0.2").repo("acme/app").token("tok")
      .fetch(fakeGithub(seen, { tagId: 7, latestId: 7 }))
  );
  assertEquals(result, {
    state: "already-latest",
    tag: "v1.0.2",
    releaseId: 7,
  });
  // Both lookups, no PATCH: an unconditional pipeline run must not churn the
  // release's audit history.
  assertEquals(seen.map((s) => s.method), ["GET", "GET"]);
});

Deno.test("a tag with no release reports no-release, not an error", async () => {
  const seen: Seen[] = [];
  const result = await GhTasks.markReleaseLatest((s) =>
    s.tag("v1.0.3").repo("acme/app").token("tok")
      .fetch(fakeGithub(seen, { tagStatus: 404 }))
  );
  assertEquals(result, { state: "no-release", tag: "v1.0.3" });
  // Nothing was written for it either.
  assertEquals(seen.map((s) => s.method), ["GET"]);
});

Deno.test("a repository with no latest release still gets the PATCH", async () => {
  // GitHub hides drafts and prereleases from the latest lookup, so a 404
  // there does not mean the tag's release is missing — the write is what
  // gives the pointer a value.
  const result = await GhTasks.markReleaseLatest((s) =>
    s.tag("v1.0.2").repo("acme/app").token("tok")
      .fetch(fakeGithub([], { latestStatus: 404 }))
  );
  assertEquals(result.state, "marked");
});

Deno.test("failures beyond the expected 404s surface with their status", async () => {
  await assertRejects(
    () =>
      GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").repo("acme/app").token("tok")
          .fetch(fakeGithub([], { tagStatus: 500 }))
      ),
    GhApiError,
    "500",
  );
  await assertRejects(
    () =>
      GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").repo("acme/app").token("tok")
          .fetch(fakeGithub([], { latestStatus: 500 }))
      ),
    GhApiError,
    "500",
  );
  await assertRejects(
    () =>
      GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").repo("acme/app").token("tok")
          .fetch(fakeGithub([], { patchStatus: 403 }))
      ),
    GhApiError,
    "refused",
  );
});

Deno.test("a lookup that returns no id names the call that failed", async () => {
  const empty: typeof fetch = async () => {
    await Promise.resolve();
    return new Response("{}", { status: 200 });
  };
  await assertRejects(
    () =>
      GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").repo("acme/app").token("tok").fetch(empty)
      ),
    Error,
    "release lookup",
  );
});

Deno.test("a GHES base URL is honored, trailing slash and all", async () => {
  const seen: Seen[] = [];
  await GhTasks.markReleaseLatest((s) =>
    s.tag("v1.0.2").repo("acme/app").token("tok")
      .baseUrl("https://ghes.example/api/v3/").fetch(fakeGithub(seen))
  );
  assertStringIncludes(
    seen[0].url,
    "https://ghes.example/api/v3/repos/acme/app/releases/tags/v1.0.2",
  );
});

Deno.test("a tag that is not a valid ref name is refused up front", async () => {
  // The tag is interpolated into a request path; a `..` would redirect a
  // token-bearing request somewhere the caller never named.
  await assertRejects(
    () =>
      GhTasks.markReleaseLatest((s) =>
        s.tag("../secrets").repo("acme/app").token("tok").fetch(() => {
          throw new Error("no request should be made for an invalid tag");
        })
      ),
    Error,
    "not a valid git ref name",
  );
});

/** Run `fn` with the Actions environment variables set to `values`. */
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

Deno.test("missing settings fail with messages that name the fix", async () => {
  await assertRejects(
    () => GhTasks.markReleaseLatest((s) => s.repo("a/b").token("t")),
    Error,
    ".tag(...)",
  );
  await withEnv(
    { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined },
    async () => {
      await assertRejects(
        () =>
          GhTasks.markReleaseLatest((s) =>
            s.tag("v1.0.2").repo("a/b").fetch(() => {
              throw new Error("no request should be made without a token");
            })
          ),
        Error,
        ".token(...)",
      );
      await assertRejects(
        () => GhTasks.markReleaseLatest((s) => s.tag("v1.0.2").token("t")),
        Error,
        "GITHUB_REPOSITORY",
      );
    },
  );
});

Deno.test("the token and repo default to the Actions environment", async () => {
  await withEnv(
    { GITHUB_TOKEN: "ghs_env", GITHUB_REPOSITORY: "acme/app" },
    async () => {
      const seen: Seen[] = [];
      await GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").fetch(fakeGithub(seen))
      );
      assertStringIncludes(seen[0].url, "/repos/acme/app/releases/tags/");
      assertEquals(seen[0].authorization, "Bearer ghs_env");
    },
  );
});
