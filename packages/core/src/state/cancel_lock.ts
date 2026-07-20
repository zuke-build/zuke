/**
 * The per-run cancellation lock. Exactly one process may drive a run's
 * compensation walk at a time — an in-process executor handling Ctrl-C/SIGTERM,
 * or an out-of-process `zuke cancel`. Holding this lock while compensating stops
 * a second canceller from settling the run `cancelled` (declaring "no
 * compensations") over a still-running cleanup; and its TTL lets a *crashed*
 * holder's lock lapse, so a later canceller can safely recover the stranded
 * `cancelling` record.
 *
 * @module
 */

import { lockKey } from "./lock.ts";
import type { StateStore } from "./store.ts";

/**
 * How long a cancel lock lives before a crashed holder's grip lapses. The
 * holder renews at half this interval, so a live canceller keeps the lock
 * indefinitely while a dead one becomes reclaimable within the TTL.
 */
export const CANCEL_LOCK_TTL_MS = 30_000;

/** A held cancellation lock; call {@link CancelLock.release} when the walk ends. */
export interface CancelLock {
  /** Stop the renewal heartbeat and release the lock (best-effort). */
  release(): Promise<void>;
}

/**
 * Try to acquire the cancellation lock for `runId`. Returns the held lock, or
 * `null` when another live canceller holds it (a crashed holder's lock lapses
 * via `ttlMs`, so a later caller reclaims it). While held, the lock renews on a
 * background, unref'd heartbeat until {@link CancelLock.release}. `ttlMs`
 * defaults to {@link CANCEL_LOCK_TTL_MS}; a shorter value is for tests that need
 * the heartbeat to fire quickly.
 */
export async function acquireCancelLock(
  store: StateStore,
  runId: string,
  actor: string,
  now: () => string,
  ttlMs: number = CANCEL_LOCK_TTL_MS,
): Promise<CancelLock | null> {
  const key = lockKey("zuke-cancel", runId);
  const result = await store.acquireLock(
    key,
    { actor, runId, since: now() },
    ttlMs,
  );
  if (!result.ok) return null;
  const token = result.token;
  // Renew at half the TTL so a long compensation walk keeps its lock. The timer
  // is unref'd so it never keeps the process alive, and renewal is best-effort:
  // a dropped renew just lets the lock lapse at its TTL (the documented
  // backstop) rather than crashing on an unhandled rejection from a background
  // timer.
  const heartbeat = setInterval(() => {
    store.renewLock(key, token, ttlMs).catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 2)));
  Deno.unrefTimer(heartbeat);
  return {
    release: async () => {
      clearInterval(heartbeat);
      // Best-effort release for the same reason: a failed release must not turn
      // a completed cancellation into a failure. The TTL reclaims the lock.
      await store.releaseLock(key, token).catch(() => {});
    },
  };
}
