// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run-held locks: a `.lock((s) => s.holdForRun())` that outlives the target
 * which took it and is held until the run settles, across a suspend and resume.
 *
 * The store's lock primitive is a TTL lock that its holder heartbeats, which is
 * right for a lock held while a body runs and wrong for one held while a run is
 * parked at a gate with no process alive. So a run-held lock is recorded on the
 * run record ({@link RunLock}), and three things keep it honest:
 *
 * - while a process works on the run, {@link RunLockHolder} heartbeats it;
 * - when the run parks, the holder renews it for a full TTL, and every later
 *   `zuke resume --check` that re-parks the run renews it again — so the TTL is
 *   how long a parked run keeps the lock with **no** process touching it;
 * - a resume {@link reclaimRunLocks | re-claims} each one before the run moves
 *   back to `running`, and whatever settles the run
 *   {@link releaseRunLocks | releases} them.
 *
 * @module
 */

import { LockConflictError, type LockHolder } from "./state/lock.ts";
import type { StateStore } from "./state/store.ts";
import type { RunLock } from "./state/types.ts";

/** A run-held lock this process is keeping alive. */
interface Held {
  /** The lock as the run record carries it. */
  lock: RunLock;
  /** The heartbeat renewing it at half its TTL. */
  heartbeat: ReturnType<typeof setInterval>;
}

/**
 * The run-held locks this process holds for the run it is executing. Module-
 * internal: the executor seeds it on a resume, the scheduler's lock acquisition
 * adds to it, and the executor renews or releases it as the run parks or
 * settles.
 */
export class RunLockHolder {
  readonly #store: StateStore | undefined;
  readonly #held = new Map<string, Held>();
  // Claims still being taken, so two targets of one run declaring the same key
  // at once — parallel siblings — take it once instead of conflicting with the
  // run itself.
  readonly #pending = new Map<string, Promise<void>>();

  /** Bind the holder to the run's state store (`undefined` for a store-less run). */
  constructor(store: StateStore | undefined) {
    this.#store = store;
  }

  /** Whether this run already holds `key` — a later target re-declaring it. */
  holds(key: string): boolean {
    return this.#held.has(key);
  }

  /**
   * Whether this run holds `key` once any claim on it still in flight lands. A
   * target-scoped lock on a key the run holds is already exclusive to the run,
   * so the target takes nothing; acquiring it again would conflict with the
   * run itself.
   */
  async covers(key: string): Promise<boolean> {
    // Re-checked after each wait: a claim that failed lets a sibling's start.
    for (;;) {
      const pending = this.#pending.get(key);
      if (pending === undefined) return this.#held.has(key);
      await pending.catch(() => {});
    }
  }

  /**
   * Take `key` for the run with `take`, unless the run holds it already. A
   * claim already in flight for the same key is awaited rather than raced; if
   * it failed, this one tries in its own right.
   */
  async claim(key: string, take: () => Promise<RunLock>): Promise<void> {
    for (;;) {
      if (this.#held.has(key)) return;
      const pending = this.#pending.get(key);
      if (pending === undefined) break;
      await pending.catch(() => {});
    }
    // Registered with no await since the check above, so a sibling claiming the
    // same key cannot slip in between.
    const attempt = take().then((lock) => this.adopt(lock));
    this.#pending.set(key, attempt);
    try {
      await attempt;
    } finally {
      this.#pending.delete(key);
    }
  }

  /** The locks held, in the order they were taken. */
  locks(): RunLock[] {
    return [...this.#held.values()].map((held) => held.lock);
  }

  /**
   * Keep `lock` alive from now on: heartbeat it at half its TTL until the run
   * parks or settles. Renewal is best-effort for the same reason a target lock's
   * is — a rejected renew must not become an unhandled rejection from a
   * background timer — and the TTL is the backstop.
   */
  adopt(lock: RunLock): void {
    const store = this.#store;
    if (store === undefined) return;
    const heartbeat = setInterval(() => {
      store.renewLock(lock.key, lock.token, lock.ttlMs).catch(() => {});
    }, Math.max(1000, Math.floor(lock.ttlMs / 2)));
    Deno.unrefTimer(heartbeat);
    this.#held.set(lock.key, { lock, heartbeat });
  }

  /** Stop renewing, without releasing — the run is no longer this process's. */
  stop(): void {
    for (const held of this.#held.values()) clearInterval(held.heartbeat);
    this.#held.clear();
  }

  /**
   * The run is parking: renew every lock for a full TTL, then stop. The record
   * keeps them, so the next process to pick the run up re-claims them.
   */
  async park(): Promise<void> {
    const store = this.#store;
    const locks = this.locks();
    this.stop();
    if (store === undefined) return;
    for (const lock of locks) {
      await store.renewLock(lock.key, lock.token, lock.ttlMs).catch(() => {});
    }
  }

  /** The run has settled: stop, and give every lock back to the store. */
  async release(): Promise<void> {
    const locks = this.locks();
    this.stop();
    await releaseRunLocks(this.#store, locks);
  }
}

/**
 * Give back the run-held locks a settled run recorded. Best-effort: a release
 * that fails leaves the lock to lapse at its TTL, which is the backstop, and
 * never turns a settlement into a failure. A token the store no longer
 * recognises — a lock that lapsed and went to another run — releases nothing.
 */
export async function releaseRunLocks(
  store: StateStore | undefined,
  locks: readonly RunLock[] | undefined,
): Promise<void> {
  if (store === undefined || locks === undefined) return;
  for (const lock of locks) {
    await store.releaseLock(lock.key, lock.token).catch(() => {});
  }
}

/**
 * Re-claim a resuming run's recorded locks before it moves back to `running`.
 *
 * Each lock is renewed with its token; one that lapsed while the run was
 * parked is taken afresh, under a new token, if it is still free. One that
 * lapsed and went to another run is a conflict: the run was promised
 * exclusivity it no longer has, so it must not continue. A refused resume gives
 * back the locks it took afresh, whose tokens the record never learned, and
 * keeps the ones it renewed: the run stays parked and still owns them.
 *
 * Returns every re-claimed lock, and separately the ones taken afresh — the
 * only ones a resume that fails after this point may give back.
 *
 * @throws {LockConflictError} naming the run that holds a lapsed lock now.
 */
export async function reclaimRunLocks(
  store: StateStore,
  locks: readonly RunLock[] | undefined,
  holder: LockHolder,
): Promise<ReclaimedLocks> {
  const reclaimed: RunLock[] = [];
  // Taken afresh here, under tokens the record has not seen yet. A refused
  // resume gives exactly these back: the record could not release them later.
  // The renewed ones stay held — the run is still parked and still owns them.
  const retaken: RunLock[] = [];
  for (const lock of locks ?? []) {
    if (await store.renewLock(lock.key, lock.token, lock.ttlMs)) {
      reclaimed.push(lock);
      continue;
    }
    const result = await store.acquireLock(lock.key, holder, lock.ttlMs);
    if (!result.ok) {
      await releaseRunLocks(store, retaken);
      throw new LockConflictError(
        result.holder,
        `Run ${holder.runId} cannot resume: its lock "${lock.key}" lapsed ` +
          `while the run was parked and is now held by ` +
          `${result.holder.actor} (run ${result.holder.runId}). The run stays ` +
          `suspended; resume it once that run finishes, or cancel it.`,
      );
    }
    const fresh = { ...lock, token: result.token };
    reclaimed.push(fresh);
    retaken.push(fresh);
  }
  return { locks: reclaimed, retaken };
}

/** What {@link reclaimRunLocks} re-claimed for a resuming run. */
export interface ReclaimedLocks {
  /** Every lock the run holds again, renewed or taken afresh. */
  locks: RunLock[];
  /** The subset taken afresh, under tokens the record has not seen. */
  retaken: RunLock[];
}
