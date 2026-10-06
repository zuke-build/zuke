// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the token cache — reuse until shortly before expiry, one fetch for
 * concurrent callers, failures not cached, and entries kept apart by identity
 * and by `fetch` seam.
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { TokenCache } from "../src/token_cache.ts";
import { type Clock, context, T0 } from "./_auth.ts";

const MINUTE = 60_000;

Deno.test("a token is reused until five minutes before it expires", async () => {
  const cache = new TokenCache<string>();
  const clock: Clock = { now: T0 };
  const ctx = context({ clock });
  let fetches = 0;
  const fresh = () => {
    fetches++;
    return Promise.resolve({
      value: `token-${fetches}`,
      expiresAt: clock.now + 60 * MINUTE,
    });
  };
  assertEquals(await cache.get(ctx, ["a"], fresh), "token-1");
  clock.now = T0 + 54 * MINUTE;
  assertEquals(await cache.get(ctx, ["a"], fresh), "token-1");
  clock.now = T0 + 55 * MINUTE;
  assertEquals(await cache.get(ctx, ["a"], fresh), "token-2");
  assertEquals(fetches, 2);
});

Deno.test("a short-lived token is refreshed at half its remaining life", async () => {
  const cache = new TokenCache<string>();
  const clock: Clock = { now: T0 };
  const ctx = context({ clock });
  let fetches = 0;
  const fresh = () => {
    fetches++;
    return Promise.resolve({ value: "t", expiresAt: clock.now + 4 * MINUTE });
  };
  await cache.get(ctx, ["a"], fresh);
  clock.now = T0 + 2 * MINUTE - 1;
  await cache.get(ctx, ["a"], fresh);
  assertEquals(fetches, 1);
  clock.now = T0 + 2 * MINUTE;
  await cache.get(ctx, ["a"], fresh);
  assertEquals(fetches, 2);
});

Deno.test("concurrent callers share one fetch", async () => {
  const cache = new TokenCache<string>();
  const ctx = context();
  let fetches = 0;
  let release = (_: string) => {};
  const fresh = () => {
    fetches++;
    return new Promise<{ value: string; expiresAt: number }>((resolve) => {
      release = (value) => resolve({ value, expiresAt: T0 + 60 * MINUTE });
    });
  };
  const first = cache.get(ctx, ["a"], fresh);
  const second = cache.get(ctx, ["a"], fresh);
  // Both callers are past the digest and parked on the one fetch.
  await new Promise((resolve) => setTimeout(resolve, 10));
  release("shared");
  assertEquals(await Promise.all([first, second]), ["shared", "shared"]);
  assertEquals(fetches, 1);
});

Deno.test("a failed fetch fails every waiter and is not cached", async () => {
  const cache = new TokenCache<string>();
  const ctx = context();
  let fetches = 0;
  const failing = () => {
    fetches++;
    return Promise.reject(new Error("endpoint down"));
  };
  // Settled together, so the second rejection is handled the moment it lands
  // rather than left unobserved while the first is being asserted on.
  const both = await Promise.allSettled([
    cache.get(ctx, ["a"], failing),
    cache.get(ctx, ["a"], failing),
  ]);
  for (const result of both) {
    assertEquals(
      result.status === "rejected" && result.reason instanceof Error
        ? result.reason.message
        : "fulfilled",
      "endpoint down",
    );
  }
  assertEquals(fetches, 1);
  assertEquals(
    await cache.get(
      ctx,
      ["a"],
      () => Promise.resolve({ value: "ok", expiresAt: T0 + 60 * MINUTE }),
    ),
    "ok",
  );
});

Deno.test("a failed refresh of an expired token is retried, not served stale", async () => {
  const cache = new TokenCache<string>();
  const clock: Clock = { now: T0 };
  const ctx = context({ clock });
  const fresh = (value: string) => () =>
    Promise.resolve({ value, expiresAt: clock.now + 60 * MINUTE });
  assertEquals(await cache.get(ctx, ["a"], fresh("first")), "first");
  clock.now = T0 + 59 * MINUTE;
  await assertRejects(
    () => cache.get(ctx, ["a"], () => Promise.reject(new Error("down"))),
    Error,
    "down",
  );
  assertEquals(await cache.get(ctx, ["a"], fresh("second")), "second");
});

Deno.test("entries are kept apart by identity and by fetch seam", async () => {
  const cache = new TokenCache<string>();
  const one = context();
  const two = context();
  const fresh = (value: string) => () =>
    Promise.resolve({ value, expiresAt: T0 + 60 * MINUTE });
  assertEquals(await cache.get(one, ["a"], fresh("a1")), "a1");
  assertEquals(await cache.get(one, ["b"], fresh("b1")), "b1");
  assertEquals(await cache.get(two, ["a"], fresh("a2")), "a2");
  assertEquals(await cache.get(one, ["a"], fresh("x")), "a1");
});
