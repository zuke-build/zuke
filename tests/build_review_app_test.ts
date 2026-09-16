// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The AI review's identity and acknowledgement (`build/review_app.ts`): which
 * token the reviewers post with under which environment, that a minted token
 * is minted once, that the App's credential is never minted for a redirected
 * repository, and that the 👀 acknowledgement is best-effort.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { captureLines } from "../packages/core/tests/_console.ts";
import {
  acknowledgeReviewCommand,
  reviewCommentToken,
} from "../build/review_app.ts";
import type { AppCredentials } from "../build/website_sync.ts";

/** A reader over a fixed env map. */
function env(
  map: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => map[name];
}

const APP = {
  ZUKE_BUILD_APP_ID: "12345",
  ZUKE_BUILD_APP_KEY:
    "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  GITHUB_REPOSITORY: "zuke-build/zuke",
  GITHUB_TOKEN: "actions-token",
};

/** A recording fake of the App-token mint. */
function fakeMint(
  result: () => Promise<string>,
): {
  mint: (credentials: AppCredentials, repo: string) => Promise<string>;
  calls: Array<{ credentials: AppCredentials; repo: string }>;
} {
  const calls: Array<{ credentials: AppCredentials; repo: string }> = [];
  return {
    calls,
    mint: (credentials, repo) => {
      calls.push({ credentials, repo });
      return result();
    },
  };
}

Deno.test("reviewCommentToken mints the App token once and shares it", async () => {
  const { mint, calls } = fakeMint(() => Promise.resolve("app-token"));
  const token = reviewCommentToken(env(APP), mint);
  assertEquals(await token(), "app-token");
  assertEquals(await token(), "app-token");
  // Both reviewers and the acknowledgement share one resolver: one mint.
  assertEquals(calls.length, 1);
  assertEquals(calls[0].repo, "zuke-build/zuke");
  assertEquals(calls[0].credentials.appId, "12345");
});

Deno.test("reviewCommentToken falls back to GITHUB_TOKEN without the App's credentials", async () => {
  const { mint, calls } = fakeMint(() => Promise.resolve("app-token"));
  // The pull_request job, and every local run: no credentials, no mint.
  const withoutKey = { ...APP, ZUKE_BUILD_APP_KEY: "" };
  assertEquals(
    await reviewCommentToken(env(withoutKey), mint)(),
    "actions-token",
  );
  assertEquals(await reviewCommentToken(env({}), mint)(), "");
  assertEquals(calls.length, 0);
});

Deno.test("reviewCommentToken refuses to mint for a repository that is not this one", async () => {
  // An environment variable must not decide what the App's credential reaches:
  // a redirected GITHUB_REPOSITORY gets the workflow token, with a warning.
  const { mint, calls } = fakeMint(() => Promise.resolve("app-token"));
  const lines = await captureLines(async () => {
    const token = reviewCommentToken(
      env({ ...APP, GITHUB_REPOSITORY: "someone/else" }),
      mint,
    );
    assertEquals(await token(), "actions-token");
  });
  assertEquals(calls.length, 0);
  assertStringIncludes(lines.join("\n"), "refusing to mint the app token");
});

Deno.test("reviewCommentToken falls back, with a warning, when minting fails", async () => {
  // The identity is a courtesy: losing it must not lose the review.
  const { mint } = fakeMint(() => Promise.reject(new Error("403 forbidden")));
  const lines = await captureLines(async () => {
    assertEquals(await reviewCommentToken(env(APP), mint)(), "actions-token");
  });
  assertStringIncludes(lines.join("\n"), "could not mint the app token");
  assertStringIncludes(lines.join("\n"), "403 forbidden");
});

/** A recording fake `fetch` answering every call with `status`. */
function fakeFetch(
  status: number,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const COMMENT = {
  GITHUB_REPOSITORY: "zuke-build/zuke",
  ZUKE_REVIEW_COMMENT: "987654",
};

Deno.test("acknowledgeReviewCommand reacts 👀 on the command comment with the resolved token", async () => {
  const { fetch, calls } = fakeFetch(201);
  const reacted = await acknowledgeReviewCommand(
    env(COMMENT),
    () => Promise.resolve("app-token"),
    fetch,
  );
  assertEquals(reacted, true);
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/comments/987654/reactions",
  );
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(calls[0].init?.body, JSON.stringify({ content: "eyes" }));
  const headers = new Headers(calls[0].init?.headers);
  assertEquals(headers.get("authorization"), "Bearer app-token");
});

Deno.test("acknowledgeReviewCommand is a no-op off a comment-started run, or without a token", async () => {
  const { fetch, calls } = fakeFetch(201);
  const token = () => Promise.resolve("app-token");
  // Not comment-started: the pull_request job and local runs.
  assertEquals(await acknowledgeReviewCommand(env({}), token, fetch), false);
  assertEquals(
    await acknowledgeReviewCommand(
      env({ GITHUB_REPOSITORY: "zuke-build/zuke" }),
      token,
      fetch,
    ),
    false,
  );
  // An id that is not a number never reaches the URL.
  assertEquals(
    await acknowledgeReviewCommand(
      env({ ...COMMENT, ZUKE_REVIEW_COMMENT: "../../evil" }),
      token,
      fetch,
    ),
    false,
  );
  // No token resolves: nothing to authenticate with.
  assertEquals(
    await acknowledgeReviewCommand(
      env(COMMENT),
      () => Promise.resolve(""),
      fetch,
    ),
    false,
  );
  assertEquals(calls.length, 0);
});

Deno.test("acknowledgeReviewCommand never throws: a refusal or a network error is a warning", async () => {
  const token = () => Promise.resolve("app-token");
  const refused = fakeFetch(403);
  const lines = await captureLines(async () => {
    assertEquals(
      await acknowledgeReviewCommand(env(COMMENT), token, refused.fetch),
      false,
    );
    const failing = (() =>
      Promise.reject(new Error("offline"))) as typeof fetch;
    assertEquals(
      await acknowledgeReviewCommand(env(COMMENT), token, failing),
      false,
    );
  });
  assertStringIncludes(lines.join("\n"), "HTTP 403");
  assertStringIncludes(lines.join("\n"), "offline");
});
