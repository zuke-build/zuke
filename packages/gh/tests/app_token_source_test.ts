// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the App token source: the lazy, memoised, best-effort
 * credential a build hands to whatever posts on its behalf. The mint is a
 * seam here — the signing and the REST calls have their own tests in
 * `app_token_test.ts` — so these are about the defaults and the fallbacks.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { captureLines } from "../../core/tests/_console.ts";
import { parameter } from "../../core/mod.ts";
import { GhTasks } from "../mod.ts";
import {
  appTokenSource,
  type GhAppTokenMint,
  GhAppTokenSettings,
} from "../mod.ts";

/** A mint that records what it was configured with and returns `token`. */
function fakeMint(
  token = "minted",
): { mint: GhAppTokenMint; seen: GhAppTokenSettings[] } {
  const seen: GhAppTokenSettings[] = [];
  const mint: GhAppTokenMint = (configure) => {
    const settings = configure(new GhAppTokenSettings());
    seen.push(settings);
    return Promise.resolve({
      token,
      expiresAt: "2026-01-01T00:00:00Z",
      installationId: 7,
    });
  };
  return { mint, seen };
}

/** An env reader over a fixed map. */
function env(
  values: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => values[name];
}

Deno.test("appTokenSource mints once, for the run's repository, and shares the token", async () => {
  const { mint, seen } = fakeMint();
  const source = GhTasks.appTokenSource((s) =>
    s.app("123", "PEM").env(env({ GITHUB_REPOSITORY: "acme/widgets" }))
      .mint(mint)
  );
  assertEquals(await source(), "minted");
  assertEquals(await source(), "minted");
  assertEquals(seen.length, 1); // the second call returned the same promise
  assertEquals(seen[0].appId_, "123");
  assertEquals(seen[0].privateKey_, "PEM");
  assertEquals(seen[0].owner_, "acme");
  assertEquals(seen[0].repositories_, ["widgets"]);
  // No narrowing asked for: the installation's own grant.
  assertEquals(seen[0].permissions_, {});
});

Deno.test("appTokenSource reads the credentials from parameters when first called", async () => {
  const appId = parameter("App id").env("APP_ID");
  const appKey = parameter("App key").secret().env("APP_KEY");
  const { mint, seen } = fakeMint();
  const source = appTokenSource((s) =>
    s.app(appId, appKey).repository("acme/widgets").mint(mint)
  );
  // Resolved after the source was built, as a build's parameters are.
  appId.resolve_("42");
  appKey.resolve_("KEY");
  assertEquals(await source(), "minted");
  assertEquals(seen[0].appId_, "42");
  assertEquals(seen[0].privateKey_, "KEY");
});

Deno.test("without the App's credentials the source yields GITHUB_TOKEN, silently", async () => {
  const appKey = parameter("App key").secret().env("APP_KEY");
  appKey.resolve_(undefined);
  const { mint, seen } = fakeMint();
  const lines = await captureLines(async () => {
    const source = appTokenSource((s) =>
      s.app("123", appKey).env(env({ GITHUB_TOKEN: "ghs_workflow" })).mint(mint)
    );
    assertEquals(await source(), "ghs_workflow");
  });
  assertEquals(seen.length, 0);
  assertEquals(lines, []);
  // And an empty string off CI, where nothing posts anyway.
  const bare = appTokenSource((s) => s.env(env({})).mint(mint));
  assertEquals(await bare(), "");
});

Deno.test("a configured fallback wins over GITHUB_TOKEN", async () => {
  const pat = parameter("Bot token").secret().env("BOT_TOKEN");
  pat.resolve_("ghp_bot");
  const source = appTokenSource((s) =>
    s.fallback(pat).env(env({ GITHUB_TOKEN: "ghs_workflow" }))
  );
  assertEquals(await source(), "ghp_bot");
});

Deno.test("a repository that is not owner/name is refused with a warning, not minted for", async () => {
  const { mint, seen } = fakeMint();
  const lines = await captureLines(async () => {
    const source = appTokenSource((s) =>
      s.app("123", "PEM").env(env({ GITHUB_TOKEN: "ghs" })).mint(mint)
    );
    assertEquals(await source(), "ghs");
  });
  assertEquals(seen.length, 0);
  assertEquals(
    lines.some((l) => l.includes('not minting the app token: ""')),
    true,
  );
});

Deno.test("a failed mint falls back with a warning naming the cause", async () => {
  const mint: GhAppTokenMint = () => Promise.reject(new Error("HTTP 401"));
  const lines = await captureLines(async () => {
    const source = appTokenSource((s) =>
      s.app("123", "PEM").repository("acme/widgets")
        .env(env({ GITHUB_TOKEN: "ghs" })).mint(mint)
    );
    assertEquals(await source(), "ghs");
  });
  assertEquals(
    lines.some((l) =>
      l.includes("could not mint the app token (HTTP 401)") &&
      l.includes("using the fallback token")
    ),
    true,
  );
});

Deno.test("permissions, fetch and baseUrl are handed to the mint", async () => {
  const { mint, seen } = fakeMint();
  const doFetch =
    ((input: string | URL | Request) =>
      Promise.resolve(new Response(String(input)))) as typeof fetch;
  const source = appTokenSource((s) =>
    s.app("123", "PEM").repository("acme/widgets")
      .permission("pull-requests", "write")
      .permission("contents", "write")
      .fetch(doFetch).baseUrl("https://ghe.example/api/v3")
      .mint(mint)
  );
  await source();
  assertEquals(seen[0].permissions_, {
    pull_requests: "write",
    contents: "write",
  });
  assertEquals(seen[0].fetch_, doFetch);
  assertEquals(seen[0].baseUrl_, "https://ghe.example/api/v3");
});
