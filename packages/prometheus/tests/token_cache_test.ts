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
    // Fails a moment later, as a real endpoint does, so both callers are
    // parked on the one fetch when it fails.
    return new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("endpoint down")), 10)
    );
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

Deno.test("a failed refresh falls back to the cached token until it expires", async () => {
  const cache = new TokenCache<string>();
  const clock: Clock = { now: T0 };
  const ctx = context({ clock });
  const fresh = (value: string) => () =>
    Promise.resolve({ value, expiresAt: clock.now + 60 * MINUTE });
  const down = () => Promise.reject(new Error("down"));
  assertEquals(await cache.get(ctx, ["a"], fresh("first")), "first");
  // Past the refresh point but before expiry: the refresh fails, the still
  // valid token is used, and the next call tries the refresh again.
  clock.now = T0 + 59 * MINUTE;
  assertEquals(await cache.get(ctx, ["a"], down), "first");
  // Past expiry: the failure is the answer.
  clock.now = T0 + 60 * MINUTE;
  await assertRejects(() => cache.get(ctx, ["a"], down), Error, "down");
  assertEquals(await cache.get(ctx, ["a"], fresh("second")), "second");
});

Deno.test("a waiter survives the caller that started the fetch giving up", async () => {
  const cache = new TokenCache<string>();
  const creator = new AbortController();
  const waiter = new AbortController();
  let release = (_: string) => {};
  let sharedSignal: AbortSignal | undefined;
  const fresh = (shared: { signal: AbortSignal }) => {
    sharedSignal = shared.signal;
    return new Promise<{ value: string; expiresAt: number }>((resolve) => {
      release = (value) => resolve({ value, expiresAt: T0 + 60 * MINUTE });
    });
  };
  const first = cache.get(context({ signal: creator.signal }), ["a"], fresh);
  const second = cache.get(context({ signal: waiter.signal }), ["a"], fresh);
  await new Promise((resolve) => setTimeout(resolve, 10));
  creator.abort(new Error("creator timed out"));
  await assertRejects(() => first, Error, "creator timed out");
  // The shared fetch runs under the cache's own signal, not the creator's.
  assertEquals(sharedSignal === creator.signal, false);
  assertEquals(sharedSignal?.aborted, false);
  release("shared");
  assertEquals(await second, "shared");
  // A waiter whose own signal fires stops waiting without failing others.
  const third = new AbortController();
  third.abort(new Error("third cancelled"));
  const cancelled = new TokenCache<string>();
  const hang = () =>
    new Promise<{ value: string; expiresAt: number }>(() => {});
  await assertRejects(
    () => cancelled.get(context({ signal: third.signal }), ["a"], hang),
    Error,
    "third cancelled",
  );
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
