/**
 * Leases over a run: a TTL'd claim, renewed by a heartbeat, that says a live
 * process is working on it.
 *
 * The point is to make "slow" and "dead" different things. A run record on its
 * own cannot tell them apart — a process that is mid-step and one that was
 * SIGKILLed both leave a record that says `running` and stops changing. A lease
 * settles it: a live holder keeps renewing, so a claim that has lapsed means the
 * holder is gone and its work can be taken over. Nothing here polls or sweeps;
 * expiry is evaluated by the store when somebody next tries to acquire.
 *
 * Generalised from the cancellation lock, which is one instance of the same
 * shape (see `./cancel_lock.ts`).
 *
 * @module
 */

import { lockKey } from "./lock.ts";
import type { StateStore } from "./store.ts";

/**
 * How long a lease lives before a crashed holder's claim lapses.
 *
 * The holder renews at half this interval, so a live process keeps its claim
 * indefinitely while a dead one becomes reclaimable within the TTL. Sixty
 * seconds trades promptness for tolerance: long enough that an ordinary pause —
 * a slow step, a busy host, a paused container — does not look like death, short
 * enough that a genuinely dead run is picked up on the next sweep rather than
 * hours later.
 */
export const RUN_LEASE_TTL_MS = 60_000;

/**
 * The lease name a run's own claim is taken under.
 *
 * Named once because two places have to agree on it exactly: the process
 * claiming a run, and any sweep deciding whether that run still has an owner.
 */
export const RUN_LEASE_PREFIX = "zuke-run";

/** A held lease. Release it when the work it covers is over. */
export interface HeldLease {
  /**
   * Aborts if the lease is lost — the store reports the claim is no longer this
   * holder's, which means something else has taken the work over.
   *
   * A signal rather than a callback because a holder is not always ready to
   * receive one at the moment it acquires: a resume takes the lease before the
   * run it will drive exists. A signal can be read late and still be true.
   */
  readonly lost: AbortSignal;
  /** Stop the heartbeat and release the claim (best-effort). */
  release(): Promise<void>;
}

/**
 * Take a lease named `prefix` over `runId`, or `null` if a live holder has it.
 *
 * While held, the lease renews on a background heartbeat until
 * {@link HeldLease.release}. That timer never keeps the process alive.
 *
 * **Only an explicit refusal counts as loss.** A store reports `false` from a
 * renewal when the claim is demonstrably somebody else's; it *throws* for a
 * filesystem mutex it could not take in time, or an HTTP 503, or a DNS blip —
 * none of which say anything about who holds the lease. Treating those as loss
 * would abort a healthy build because the state service had a bad second, so
 * they are swallowed and the next tick tries again. A store that stays
 * unreachable lets the claim lapse at its TTL, which is the documented backstop
 * and the honest outcome.
 */
export async function acquireLease(
  store: StateStore,
  prefix: string,
  runId: string,
  actor: string,
  now: () => string,
  ttlMs: number = RUN_LEASE_TTL_MS,
  runUrl?: string,
): Promise<HeldLease | null> {
  const key = lockKey(prefix, runId);
  const result = await store.acquireLock(
    key,
    { actor, runId, since: now(), ...(runUrl === undefined ? {} : { runUrl }) },
    ttlMs,
  );
  if (!result.ok) return null;
  const token = result.token;
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void renew();
  }, Math.max(1000, Math.floor(ttlMs / 2)));
  // Never keep the process alive for a heartbeat; the work decides when the run
  // ends, not the bookkeeping.
  Deno.unrefTimer(heartbeat);

  /** One renewal: report loss, ignore anything that is merely a bad moment. */
  async function renew(): Promise<void> {
    let held: boolean;
    try {
      held = await store.renewLock(key, token, ttlMs);
    } catch {
      return; // transient — says nothing about who holds the lease
    }
    if (held) return;
    clearInterval(heartbeat);
    controller.abort(
      new Error(
        `the lease on run "${runId}" was lost — another process has taken it ` +
          `over, so this one must stop rather than keep working on it`,
      ),
    );
  }

  return {
    lost: controller.signal,
    release: async () => {
      clearInterval(heartbeat);
      // Best-effort, like the heartbeat: a failed release must not turn
      // completed work into a failure. The TTL reclaims the lease.
      await store.releaseLock(key, token).catch(() => {});
    },
  };
}
