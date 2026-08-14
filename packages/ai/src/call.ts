// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one provider call every pass makes: consult the cost cache, respect the
 * budget, call the provider, parse the response, record the spend, and store the
 * result — in that order, because a cached response is free and must be served
 * even once the budget is spent.
 *
 * Module-internal: the reviewer and the fixer share it, and nothing here is
 * re-exported from `mod.ts`.
 *
 * @module
 */

import type { Budget } from "./budget.ts";
import type { AiCache } from "./cache.ts";
import { type CallOptions, callProvider } from "./provider.ts";
import type { Provider, Usage } from "./types.ts";

/** A parsed provider response, and where it came from. */
export interface CachedResult<T> {
  /** The parsed value — whatever the pass's own `parse` produced. */
  value: T;
  /** Token usage as the provider (or the cache entry) reported it. */
  usage?: Usage;
  /** Whether the cache served it — no API call was made, nothing was spent. */
  fromCache: boolean;
}

/**
 * The alternative outcome: the budget is spent, so no call was made. Returned
 * rather than reported, because each pass announces a skip its own way.
 */
export interface BudgetExhausted {
  /** The budget's own one-line summary, for the skip message. */
  exhausted: string;
}

/** What one cached provider call needs, on top of the {@link CallOptions}. */
export interface CachedCallSpec<T> extends CallOptions {
  /** The model provider to call. */
  provider: Provider;
  /** The resolved API key. */
  key: string;
  /** The resolved model name. */
  model: string;
  /** The system prompt. */
  system: string;
  /** The user prompt. */
  user: string;
  /** Turn the provider's raw text into the pass's own type. May throw. */
  parse: (text: string) => T;
  /** The cost cache, when the pass has one configured. */
  cache?: AiCache;
  /** The budget to charge, when the pass has one configured. */
  budget?: Budget;
}

/**
 * Make one provider call through the cache and the budget, or report the budget
 * is spent. Throws whatever the provider or `parse` throws, so each pass keeps
 * its own error policy (the reviewer's `onError`, the fixer's warn-and-give-up).
 *
 * `effort` is part of the cache key because it changes the model's output —
 * omitting it would serve a response computed at a different reasoning effort.
 *
 * `parse` runs on a cached entry too, so a corrupt one surfaces through the
 * caller's error handling instead of escaping it.
 */
export async function cachedCall<T>(
  spec: CachedCallSpec<T>,
): Promise<CachedResult<T> | BudgetExhausted> {
  const { provider, key, model, system, user, parse, cache, budget, ...call } =
    spec;
  const cacheKey = cache?.enabled_() === true
    ? cache.key_([provider, model, call.effort ?? "", system, user])
    : undefined;
  const cached = cacheKey === undefined
    ? undefined
    : await cache?.get_(cacheKey);
  if (cached !== undefined) {
    return { value: parse(cached.text), usage: cached.usage, fromCache: true };
  }
  if (budget?.exhausted_() === true) return { exhausted: budget.describe_() };
  const result = await callProvider(provider, key, model, system, user, call);
  // Parse before recording: a response that cannot be read is not a fix or an
  // assessment, and must not be charged or cached as one.
  const value = parse(result.text);
  budget?.record_(result.usage, model);
  if (cacheKey !== undefined) {
    await cache?.put_(cacheKey, result.text, result.usage);
  }
  return { value, usage: result.usage, fromCache: false };
}
