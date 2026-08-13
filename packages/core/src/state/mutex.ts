// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
 * later writer until a human deletes it. Only a **stamped** marker is ever
 * reclaimed — see {@link markerExpired} for why an unstamped one must not be.
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
 * duration of `fn`, then release it. A marker whose holder was killed inside the
 * critical section is reclaimed once its stamp passes {@link MUTEX_TTL_MS}, so a
 * single crashed writer cannot wedge the directory for every later one.
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
        // rejected write releases the marker instead of leaving an unstamped one
        // behind — which no waiter may reclaim, and so would wedge the directory.
        await host.writeText(marker, String(host.now()));
        return await fn();
      } finally {
        await host.remove(marker);
      }
    }
    if (await markerExpired(host, marker) && await steal(host, marker)) {
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
 * holder is gone and left it behind.
 *
 * A marker with **no readable numeric stamp is never expired**. It looks
 * abandoned, but it is also exactly how a live holder reads in the instant
 * between creating its marker and stamping it — two separate syscalls, so on
 * Windows or a network filesystem that gap is milliseconds, and no waiter can
 * time it. Reclaiming an unstamped marker would therefore let a waiter take one
 * whose holder is already inside the critical section, putting two writers there
 * at once and defeating the compare-and-swap the mutex exists to make safe.
 * Mutual exclusion is worth more than auto-recovering the marker a holder killed
 * in that window leaves behind: that one wedges, and the error
 * {@link withFileMutex} raises names the file to delete.
 */
async function markerExpired(
  host: StateHost,
  marker: string,
): Promise<boolean> {
  const stamp = await host.readText(marker);
  if (stamp === null || !/^\d+$/.test(stamp)) return false;
  return host.now() - Number(stamp) > MUTEX_TTL_MS;
}
