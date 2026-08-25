// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A target's cross-run lock: acquire it (if declared) before the body runs,
 * heartbeat it at half its TTL while the body runs, and release it on every exit
 * path. Backed by the durable state store's compare-and-swap lock primitive.
 *
 * Acquisition fails at the first conflict unless the target sets a wait, in
 * which case it retries until the lock frees or the wait is spent.
 *
 * @module
 */

import { LockSettings, type TargetBuilder } from "./target.ts";
import { LockConflictError, type LockHolder } from "./state/lock.ts";
import type { LockResult, StateStore } from "./state/store.ts";
import { parseDuration } from "./duration.ts";
import type { RunEnv } from "./run_support.ts";

/** How often a wait retries when the target names no interval. */
const DEFAULT_POLL_MS = 5_000;

/** A held cross-run lock: `release` clears its heartbeat and frees it. */
export interface HeldLock {
  /** Clear the heartbeat and release the lock (best-effort). */
  release(): Promise<void>;
}

/** Where a message about the lock goes while a target waits for it. */
export type LockNotice = (line: string) => void;

/** Render a duration in milliseconds the way the settings accept one. */
function renderDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/** How the holder is named in every message about the lock. */
function describeHolder(holder: LockHolder): string {
  const url = holder.runUrl === undefined ? "" : ` — ${holder.runUrl}`;
  return `${holder.actor} (run ${holder.runId}) since ${holder.since}${url}`;
}

/**
 * The default conflict guidance when a target declares no `onConflict`. A
 * target that waited says so, so the message is not read as a lock that was
 * never retried.
 */
function defaultConflictGuidance(
  key: string,
  holder: LockHolder,
  waitedMs: number,
): string {
  const waited = waitedMs > 0
    ? `still held after waiting ${renderDuration(waitedMs)}. `
    : "";
  return `Lock "${key}" is held by ${describeHolder(holder)}. ${waited}` +
    `Wait for that run to finish, or stop it, then retry.`;
}

/** The line printed when a target starts waiting, or the holder changes. */
function waitingNotice(
  key: string,
  holder: LockHolder,
  waitMs: number,
  pollMs: number,
): string {
  return `Waiting for lock "${key}", held by ${describeHolder(holder)}. ` +
    `Retrying every ${renderDuration(pollMs)} for up to ` +
    `${renderDuration(waitMs)}.`;
}

/**
 * Sleep for `ms`, or until the run is cancelled — whichever comes first. A wait
 * of half an hour must not outlive the run it belongs to.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** The identity of a lock attempt: who is asking, and from which run. */
function holderFor(env: RunEnv): LockHolder {
  const holder: LockHolder = {
    actor: env.actor,
    runId: env.runId,
    since: new Date().toISOString(),
  };
  if (env.runUrl !== undefined) holder.runUrl = env.runUrl;
  return holder;
}

/**
 * Try to take `key`, retrying until the wait is spent. Returns the successful
 * result, or the last conflict when the deadline passes. Each attempt stamps a
 * fresh `since`, so a lock finally taken reports when it was taken.
 */
async function acquireWithin(
  store: StateStore,
  key: string,
  env: RunEnv,
  ttlMs: number,
  waitMs: number,
  pollMs: number,
  notify: LockNotice | undefined,
): Promise<LockResult> {
  const deadline = Date.now() + waitMs;
  let announced: string | undefined;
  for (;;) {
    const result = await store.acquireLock(key, holderFor(env), ttlMs);
    if (result.ok) return result;
    const remaining = deadline - Date.now();
    // No wait was declared (remaining is already negative), it is spent, or the
    // run was cancelled — either way this conflict is the answer. The abort
    // check belongs here rather than only inside the sleep: `addEventListener`
    // on an already-aborted signal never fires, so a signal that aborted while
    // the attempt above was in flight would otherwise sleep out the whole poll
    // interval before anyone noticed.
    if (remaining <= 0 || env.signal.aborted) return result;
    if (result.holder.runId !== announced) {
      announced = result.holder.runId;
      notify?.(waitingNotice(key, result.holder, waitMs, pollMs));
    }
    await sleep(Math.min(pollMs, remaining), env.signal);
  }
}

/**
 * Acquire a target's cross-run lock, if it declares one. Returns `null` when it
 * declares no lock, or a {@link HeldLock} once acquired. Throws a
 * {@link LockConflictError} when another run holds it — at once, or after the
 * target's wait is spent — or a friendly error when a lock is declared but no
 * store is configured.
 *
 * `notify` receives a line each time the target settles in behind a new holder,
 * so a run that is queueing says whose lock it is waiting on.
 */
export async function acquireTargetLock(
  t: TargetBuilder,
  env: RunEnv,
  notify?: LockNotice,
): Promise<HeldLock | null> {
  const configure = t.lock_;
  if (configure === undefined) return null;
  // Run the settings lambda now — after parameters have resolved — so a key
  // built from `this.<param>.value` sees the final value.
  const settings = configure(new LockSettings());
  const name = t.name_ ?? "?";
  const key = settings.key_;
  if (key === undefined) {
    throw new Error(
      `Target "${name}" .lock(...) set no key — call s.lockKey(...) or s.key(...).`,
    );
  }
  const store = env.store;
  if (store === undefined) {
    throw new Error(
      `Target "${name}" declares .lock("${key}") but no state store is ` +
        `configured — a lock needs one. Pass --state, set ZUKE_STATE_DIR / ` +
        `ZUKE_STATE_URL, or override stateStore().`,
    );
  }
  if (settings.ttl_ === undefined) {
    throw new Error(
      `Target "${name}" .lock("${key}") set no TTL — call s.withTtl(...).`,
    );
  }
  const ttlMs = parseDuration(settings.ttl_);
  const waitMs = settings.waitUpTo_ === undefined
    ? 0
    : parseDuration(settings.waitUpTo_);
  const pollMs = settings.pollEvery_ === undefined
    ? DEFAULT_POLL_MS
    : parseDuration(settings.pollEvery_);

  const result = await acquireWithin(
    store,
    key,
    env,
    ttlMs,
    waitMs,
    pollMs,
    notify,
  );
  if (!result.ok) {
    const guidance = settings.onConflict_
      ? settings.onConflict_(result.holder)
      : defaultConflictGuidance(key, result.holder, waitMs);
    throw new LockConflictError(result.holder, guidance);
  }

  const token = result.token;
  // Renew at half the TTL so a long body keeps its short-TTL lock; cleared on
  // release. The interval is unref'd so it never keeps the process alive.
  // Renewal is best-effort: `.catch` swallows a rejected renew (store contention
  // or a transient error) so it can never surface as an unhandled rejection that
  // crashes the build from a background timer — the lock simply lapses at its
  // TTL, which is the documented backstop.
  const heartbeat = setInterval(() => {
    store.renewLock(key, token, ttlMs).catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 2)));
  Deno.unrefTimer(heartbeat);
  return {
    release: async () => {
      clearInterval(heartbeat);
      // Best-effort release for the same reason: a failed release must not turn
      // an otherwise-succeeded body into a failure. The TTL reclaims the lock.
      await store.releaseLock(key, token).catch(() => {});
    },
  };
}
