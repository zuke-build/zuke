/**
 * A target's cross-run lock: acquire it (if declared) before the body runs,
 * heartbeat it at half its TTL while the body runs, and release it on every exit
 * path. Backed by the durable state store's compare-and-swap lock primitive.
 *
 * @module
 */

import { LockSettings, type TargetBuilder } from "./target.ts";
import { LockConflictError, type LockHolder } from "./state/lock.ts";
import { parseDuration } from "./duration.ts";
import type { RunEnv } from "./run_support.ts";

/** A held cross-run lock: `release` clears its heartbeat and frees it. */
export interface HeldLock {
  /** Clear the heartbeat and release the lock (best-effort). */
  release(): Promise<void>;
}

/** The default conflict guidance when a target declares no `onConflict`. */
function defaultConflictGuidance(key: string, holder: LockHolder): string {
  const url = holder.runUrl === undefined ? "" : ` — ${holder.runUrl}`;
  return `Lock "${key}" is held by ${holder.actor} (run ${holder.runId}) ` +
    `since ${holder.since}${url}. Wait for that run to finish, or stop it, ` +
    `then retry.`;
}

/**
 * Acquire a target's cross-run lock, if it declares one. Returns `null` when it
 * declares no lock, or a {@link HeldLock} once acquired. Throws a
 * {@link LockConflictError} when another run holds it, or a friendly error when
 * a lock is declared but no store is configured.
 */
export async function acquireTargetLock(
  t: TargetBuilder,
  env: RunEnv,
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
  const holder: LockHolder = {
    actor: env.actor,
    runId: env.runId,
    since: new Date().toISOString(),
  };
  if (env.runUrl !== undefined) holder.runUrl = env.runUrl;

  const result = await store.acquireLock(key, holder, ttlMs);
  if (!result.ok) {
    const guidance = settings.onConflict_
      ? settings.onConflict_(result.holder)
      : defaultConflictGuidance(key, result.holder);
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
