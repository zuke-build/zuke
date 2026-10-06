// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link TokenCache}: keep a fetched credential until shortly before it
 * expires, and let concurrent calls share one fetch.
 *
 * A settings lambda runs once per call, so a credential source built inside
 * it is new every time and cannot keep a token in its own closure. The cache
 * therefore lives at module level, one per provider, keyed by a digest of
 * everything that identifies the credential (the key file's contents, the
 * client, the scope, the endpoint) — so a rotated key or a different scope is
 * a different entry, and a secret is never held as a map key in the clear.
 *
 * Entries are kept per `fetch` seam: the global `fetch` shares one cache
 * process-wide, and a test's fake `fetch` gets its own, so tests cannot see
 * each other's tokens.
 *
 * @module
 */

import { sha256Hex } from "@zuke/core";
import { raceSignal } from "./abort.ts";
import type { PrometheusCredentialsContext } from "./credentials.ts";

/** How long before expiry a token is refreshed, at most: five minutes. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * How long a shared token fetch may take. It runs under its own timeout, not
 * any one caller's, so the caller that happened to start it cannot cancel it
 * for everyone else waiting on it.
 */
const TOKEN_FETCH_TIMEOUT_MS = 30_000;

/** A fetched credential and the epoch-ms instant it stops working. */
export interface Expiring<T> {
  /** The credential. */
  readonly value: T;
  /** When it expires, in epoch milliseconds. */
  readonly expiresAt: number;
}

/** A cached credential, when to refresh it, and when it stops working. */
interface Cached<T> {
  /** The credential. */
  readonly value: T;
  /** When to fetch a fresh one, in epoch ms. */
  readonly refreshAt: number;
  /** When it stops working, in epoch ms. */
  readonly expiresAt: number;
}

/** One key's state: a usable value, a fetch in flight, or both. */
interface Entry<T> {
  /** The cached value. */
  readonly cached?: Cached<T>;
  /** The fetch every concurrent caller awaits. */
  readonly pending?: Promise<T>;
}

/** A per-provider cache of expiring credentials. */
export class TokenCache<T> {
  /** The entries, per `fetch` seam, by key digest. */
  readonly #entries = new WeakMap<typeof fetch, Map<string, Entry<T>>>();

  /**
   * The credential for `identity`: the cached one while it is fresh, else
   * the result of `fetchFresh` — shared with every concurrent caller asking
   * for the same identity, so two calls racing at expiry make one request.
   *
   * A value is fresh until `expiresAt` minus five minutes, or minus half its
   * remaining life when that is shorter. The shared fetch runs under its own
   * timeout (it is handed a context whose signal is the cache's, not the
   * caller's); each caller stops waiting when its own signal fires, without
   * cancelling the fetch for the others. When a refresh fails while the
   * cached value has not yet expired, the cached value is used; otherwise the
   * failure is returned and not cached, so the next call tries again.
   */
  async get(
    context: PrometheusCredentialsContext,
    identity: readonly unknown[],
    fetchFresh: (shared: PrometheusCredentialsContext) => Promise<Expiring<T>>,
  ): Promise<T> {
    const key = await sha256Hex(JSON.stringify(identity));
    let entries = this.#entries.get(context.fetch);
    if (entries === undefined) {
      entries = new Map();
      this.#entries.set(context.fetch, entries);
    }
    const entry = entries.get(key);
    const stale = entry?.cached;
    if (stale !== undefined && context.now() < stale.refreshAt) {
      return stale.value;
    }
    if (entry?.pending !== undefined) {
      return await raceSignal(entry.pending, context.signal);
    }
    const map = entries;
    const shared = {
      ...context,
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    };
    const pending = fetchFresh(shared).then((fresh) => {
      const now = context.now();
      const margin = Math.min(REFRESH_MARGIN_MS, (fresh.expiresAt - now) / 2);
      map.set(key, {
        cached: {
          value: fresh.value,
          refreshAt: fresh.expiresAt - margin,
          expiresAt: fresh.expiresAt,
        },
      });
      return fresh.value;
    }, (error: unknown) => {
      map.set(key, { cached: stale });
      if (stale !== undefined && context.now() < stale.expiresAt) {
        return stale.value;
      }
      throw error;
    });
    map.set(key, { cached: stale, pending });
    return await raceSignal(pending, context.signal);
  }
}
