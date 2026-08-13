// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the shared PR-comment poster: token resolution, the no-context
 * no-op, and the best-effort error handling.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { postComment } from "../src/comment.ts";

/** A recorded request. */
interface Call {
  url: string;
  auth: string;
}

/** A fake `fetch` recording each call's URL and Authorization header. */
function recordFetch(): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      auth: headers.get("authorization") ?? "",
    });
    const method = init?.method ?? "GET";
    return Promise.resolve(
      new Response(method === "GET" ? "[]" : "{}", { status: 200 }),
    );
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const PR_ENV: Record<string, string> = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_REF: "refs/pull/7/merge",
};

Deno.test("postComment is a no-op off any CI host", async () => {
  const { fetch, calls } = recordFetch();
  await postComment("sec", "## body", { env: () => undefined, fetch });
  assertEquals(calls.length, 0);
});

Deno.test("an explicit commentToken wins over the host env token", async () => {
  const { fetch, calls } = recordFetch();
  await postComment("sec", "## body", {
    commentToken: "explicit-token",
    env: (n) => n === "GITHUB_TOKEN" ? "env-token" : PR_ENV[n],
    fetch,
  });
  assertEquals(calls.length, 2); // list, then create
  for (const call of calls) {
    assertEquals(call.auth, "Bearer explicit-token");
  }
});

Deno.test("no token at all prepares no upsert — nothing is fetched", async () => {
  const { fetch, calls } = recordFetch();
  // The host is detected, but GITHUB_TOKEN is unset, so the empty token yields
  // no PR context and the comment is silently skipped.
  await postComment("sec", "## body", { env: (n) => PR_ENV[n], fetch });
  assertEquals(calls.length, 0);
});

Deno.test("a non-Error throw from the upsert is stringified into the warning", async () => {
  // Rejects with a bare string (not an Error), pinning the String(error)
  // fallback in postComment's catch.
  const throwing = (() => Promise.reject("socket torn down")) as typeof fetch;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
  try {
    await postComment("sec", "## body", {
      commentToken: "tok",
      env: (n) => PR_ENV[n],
      fetch: throwing,
    });
  } finally {
    console.warn = warn;
  }
  assertEquals(warnings.length, 1);
  assertStringIncludes(
    warnings[0],
    "[sec] could not post PR comment: socket torn down",
  );
});
