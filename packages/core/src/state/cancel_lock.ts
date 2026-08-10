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

import { acquireLease } from "./run_lease.ts";
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
 *
 * A thin naming of {@link "./run_lease.ts".acquireLease}: a cancel lock is one
 * lease over a run, and the mechanics — the TTL, the half-TTL heartbeat, the
 * best-effort release — belong to leases in general rather than to cancellation.
 * The narrower return type is deliberate: a compensation walk has no use for the
 * lease's loss signal, since the recovery path a lapsed cancel lock enables is
 * driven by the *next* canceller, not by this one noticing.
 */
export async function acquireCancelLock(
  store: StateStore,
  runId: string,
  actor: string,
  now: () => string,
  ttlMs: number = CANCEL_LOCK_TTL_MS,
): Promise<CancelLock | null> {
  const lease = await acquireLease(
    store,
    "zuke-cancel",
    runId,
    actor,
    now,
    ttlMs,
  );
  return lease === null ? null : { release: () => lease.release() };
}
