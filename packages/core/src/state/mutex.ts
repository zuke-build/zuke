/**
 * {@link withFileMutex} — the filesystem mutex the single-host backends hold
 * while they publish a file: {@link "./fs_store.ts".FileSystemStateStore} for run
 * records and cross-run locks, and
 * {@link "../registry/fs_registry.ts".FileSystemBuildRegistry} for build
 * descriptors. One implementation, so the two cannot drift apart.
 *
 * A marker file created with `O_EXCL` is the mutex; the holder stamps it with the
 * acquire time, so a waiter can tell a live holder from one that was killed
 * inside its critical section and reclaim the marker instead of wedging every
 * later writer until a human deletes it.
 *
 * @module
 */

import type { StateHost } from "./store.ts";
import { delay } from "../internal.ts";

/** How long to wait for a contended marker before giving up (~1s in total). */
const LOCK_ATTEMPTS = 100;
const LOCK_DELAY_MS = 10;

/**
 * How old a mutex marker may get before a waiter treats it as abandoned and
 * takes it over — the same 30s backstop a cross-run lock's TTL gives a crashed
 * holder ({@link "./cancel_lock.ts".CANCEL_LOCK_TTL_MS}). Two orders of
 * magnitude above the ~1s spin budget above, so a live holder is never stolen
 * from, yet a killed one cannot wedge the directory for good.
 */
const MUTEX_TTL_MS = 30_000;

/** What one {@link withFileMutex} call guards, and how to name it in an error. */
export interface FileMutex {
  /** Filesystem access — the caller's injected host, so tests can fake it. */
  host: StateHost;
  /** Path of the exclusive marker file to hold for the critical section. */
  marker: string;
  /** Message prefix identifying the subsystem, e.g. `state` or `registry`. */
  scope: string;
  /** What is being guarded, e.g. `run "9f2…"` or `build "CI"`. */
  subject: string;
}

/**
 * Hold `mutex.marker` exclusively (spinning briefly on contention) for the
 * duration of `fn`, then release it. A marker whose holder was killed is
 * reclaimed once it passes {@link MUTEX_TTL_MS} — or, when it carries no stamp to
 * age, once the spin has run long enough to rule out a holder still writing one
 * — so a single crashed writer cannot wedge the directory for every later one.
 *
 * @throws if the marker is still held, and fresh, after the whole spin budget.
 */
export async function withFileMutex<T>(
  mutex: FileMutex,
  fn: () => Promise<T>,
): Promise<T> {
  const { host, marker } = mutex;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    if (await host.createExclusive(marker)) {
      try {
        // Stamp the marker with the acquire time so a later waiter can tell a
        // live holder from one that died holding it. Inside the `try`, so a
        // rejected write releases the marker instead of leaving an unstamped
        // one behind — which would read as a live holder for good.
        await host.writeText(marker, String(host.now()));
        return await fn();
      } finally {
        await host.remove(marker);
      }
    }
    // Half the spin budget is far longer than the microseconds between a
    // holder's create and its stamp, so past that point an unstamped marker is
    // a leftover — including one from a zuke that never stamped at all — and
    // may be reclaimed. Earlier than that, treat it as a holder mid-stamp.
    const unstampedIsStale = attempt >= LOCK_ATTEMPTS / 2;
    if (
      await markerExpired(host, marker, unstampedIsStale) &&
      await steal(host, marker)
    ) {
      continue; // reclaimed: retry the exclusive create straight away
    }
    await delay(LOCK_DELAY_MS);
  }
  throw new Error(
    `${mutex.scope}: could not acquire the mutex for ${mutex.subject} — ` +
      `a stale ${marker} may need removing.`,
  );
}

/**
 * Reclaim the abandoned `marker`, reporting whether this caller was the one
 * that removed it.
 *
 * The marker is moved aside with an atomic rename before being deleted. A bare
 * `remove` is not a compare-and-swap: two waiters that both read the same stale
 * stamp would both delete a marker, the second deleting the one the first had
 * just taken, and both would then be inside the critical section. Only one
 * rename can find the marker, so at most one waiter reclaims it; the loser gets
 * `false` and goes back to spinning, where it re-reads the new holder's stamp.
 */
async function steal(host: StateHost, marker: string): Promise<boolean> {
  const stolen = `${marker}.steal-${crypto.randomUUID()}`;
  try {
    await host.rename(marker, stolen);
  } catch {
    return false; // another waiter reclaimed it first, or the holder released
  }
  await host.remove(stolen);
  return true;
}

/**
 * Whether `marker` was acquired longer ago than {@link MUTEX_TTL_MS} — its
 * holder is gone and left it behind. A marker with no readable numeric stamp
 * has no age to compare, so `unstampedIsStale` decides it: the caller passes
 * `false` while a holder could still be writing its stamp, and `true` once it
 * has spun long enough that no live holder could still be in that window.
 */
async function markerExpired(
  host: StateHost,
  marker: string,
  unstampedIsStale: boolean,
): Promise<boolean> {
  const stamp = await host.readText(marker);
  if (stamp === null || !/^\d+$/.test(stamp)) return unstampedIsStale;
  return host.now() - Number(stamp) > MUTEX_TTL_MS;
}
