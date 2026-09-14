// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the shared PR-comment poster: token resolution, the no-context
 * no-op, the best-effort error handling, and the redaction both publish paths
 * apply before anything reaches the host API.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  postComment,
  postGithubSuggestions,
  type Redact,
} from "../src/comment.ts";

/**
 * The redactor for the tests that are about something else. Named rather than
 * inlined so that a test passing secrets through untouched is a visible choice
 * and not an oversight.
 */
const KEEP: Redact = (text) => text;

/** A recorded request. */
interface Call {
  url: string;
  auth: string;
  /** The request body, so a test can assert what actually left the process. */
  body: string;
}

/** A fake `fetch` recording each call's URL and Authorization header. */
function recordFetch(): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      auth: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
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
  await postComment("sec", "## body", {
    env: () => undefined,
    redact: KEEP,
    fetch,
  });
  assertEquals(calls.length, 0);
});

Deno.test("an explicit commentToken wins over the host env token", async () => {
  const { fetch, calls } = recordFetch();
  await postComment("sec", "## body", {
    commentToken: "explicit-token",
    env: (n) => n === "GITHUB_TOKEN" ? "env-token" : PR_ENV[n],
    redact: KEEP,
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
  await postComment("sec", "## body", {
    env: (n) => PR_ENV[n],
    redact: KEEP,
    fetch,
  });
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
      redact: KEEP,
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

/**
 * A fetch that answers the three requests the suggestion path makes: the pull
 * request (for its head sha), the existing review comments (none), and the
 * POST that creates each suggestion.
 */
function suggestFetch(): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      auth: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "POST"
      ? "{}"
      : url.includes("/comments")
      ? "[]"
      : '{"head":{"sha":"deadbeef"}}';
    return Promise.resolve(new Response(payload, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

// The value a build declared as a secret, standing in for one that came back
// through a model's reply to a prompt built from the failed command. A canary,
// not a credential-shaped literal: the test only needs a string distinctive
// enough to search a request body for.
const CANARY = "canary-value-that-must-not-escape";
const MASK: Redact = (text) => text.replaceAll(CANARY, "***");

Deno.test("postComment masks a run secret before the comment body is sent", async () => {
  const { fetch, calls } = recordFetch();
  await postComment("sec", `## body\n\nfailed with ${CANARY} in the log`, {
    commentToken: "tok",
    env: (n) => PR_ENV[n],
    redact: MASK,
    fetch,
  });
  // Asserted on what the seam received, not on a return value: the defect this
  // pins is the raw text reaching the host API, and a comment cannot be taken
  // back once it has.
  const posted = calls.filter((c) => c.body !== "");
  assertEquals(posted.length, 1);
  assertEquals(posted[0].body.includes(CANARY), false);
  assertStringIncludes(posted[0].body, "***");
});

Deno.test("postGithubSuggestions masks a run secret in a suggestion body", async () => {
  const { fetch, calls } = suggestFetch();
  const posted = await postGithubSuggestions("sec", [{
    path: "src/app.ts",
    line: 12,
    body: '```suggestion\nexport const greeting = "' + CANARY + '";\n```',
    key: "src/app.ts:12",
  }], {
    commentToken: "tok",
    env: (n) => PR_ENV[n],
    redact: MASK,
    fetch,
  });
  assertEquals(posted, 1);
  // The sharper of the two paths: a suggestion block is committable in one
  // click, so an unmasked secret here is not merely disclosed but proposed for
  // check-in.
  const creates = calls.filter((c) => c.body !== "");
  assertEquals(creates.length, 1);
  assertEquals(creates[0].body.includes(CANARY), false);
  assertStringIncludes(creates[0].body, "***");
});

Deno.test("a suggestion's diff coordinates survive redaction", () => {
  // `path` and the `key` derived from it are not passed through the redactor:
  // GitHub matches them against the diff, so masking them would break posting
  // rather than protect anything. Pinned so a later "redact everything" does
  // not quietly break the suggestion path.
  const { fetch, calls } = suggestFetch();
  return postGithubSuggestions("sec", [{
    path: "src/app.ts",
    line: 12,
    body: "nothing sensitive",
    key: "src/app.ts:12",
  }], {
    commentToken: "tok",
    env: (n) => PR_ENV[n],
    redact: () => "***",
    fetch,
  }).then(() => {
    const creates = calls.filter((c) => c.body !== "");
    assertEquals(creates.length, 1);
    const sent: unknown = JSON.parse(creates[0].body);
    assertEquals(
      typeof sent === "object" && sent !== null && "path" in sent
        ? sent.path
        : undefined,
      "src/app.ts",
    );
  });
});

Deno.test("a throwing redactor never escapes either publish path", async () => {
  // Both functions promise they cannot fail a build — postComment returns
  // nothing and swallows, postGithubSuggestions is documented "total by
  // construction". The redactor comes from the caller, so it is the one piece
  // of these functions that can throw for reasons neither controls; masking
  // that fails has to be a skipped courtesy, not a broken build.
  const boom: Redact = () => {
    throw new Error("redactor exploded");
  };
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
  try {
    const one = recordFetch();
    await postComment("sec", "## body", {
      commentToken: "tok",
      env: (n) => PR_ENV[n],
      redact: boom,
      fetch: one.fetch,
    });

    const two = suggestFetch();
    const posted = await postGithubSuggestions("sec", [{
      path: "src/app.ts",
      line: 12,
      body: "anything",
      key: "src/app.ts:12",
    }], {
      commentToken: "tok",
      env: (n) => PR_ENV[n],
      redact: boom,
      fetch: two.fetch,
    });
    // Reported as "nothing posted" rather than thrown, so a caller falling back
    // to the overview comment still gets a usable answer.
    assertEquals(posted, 0);
    // And nothing was created with an unmasked body.
    assertEquals(two.calls.filter((c) => c.body !== "").length, 0);
  } finally {
    console.warn = warn;
  }
  assertEquals(warnings.length, 2);
});
