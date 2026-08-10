/**
 * Unit tests for the run lease — the claim that makes "slow" and "dead"
 * different things, and the rule about what counts as losing it.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import {
  acquireLease,
  RUN_LEASE_PREFIX,
  RUN_LEASE_TTL_MS,
} from "../src/state/run_lease.ts";
import { acquireCancelLock } from "../src/state/cancel_lock.ts";
import type { StateStore } from "../src/state/store.ts";

const NOW = () => "2026-08-10T10:00:00.000Z";

/** A store that records lock traffic and answers renewals as a test dictates. */
class LockStore implements StateStore {
  /** Keys currently held, mapped to their token. */
  held = new Map<string, string>();
  /** Every key an acquire was attempted for, in order. */
  acquired: string[] = [];
  /** Keys released, in order. */
  released: string[] = [];
  /** Renewal calls, in order. */
  renewals: string[] = [];
  /** Refuse the next acquire, as though a live holder had it. */
  refuseAcquire = false;
  /** What renewals answer: held, lost, or a thrown transient. */
  renewal: "held" | "lost" | "throws" = "held";
  #tokens = 0;

  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getRun(): Promise<null> {
    return Promise.resolve(null);
  }
  putRun(): Promise<{ ok: true; version: string }> {
    return Promise.resolve({ ok: true, version: "1" });
  }
  deleteRun(): Promise<void> {
    return Promise.resolve();
  }
  acquireLock(
    key: string,
  ): Promise<
    { ok: true; token: string } | {
      ok: false;
      holder: { actor: string; runId: string; since: string };
    }
  > {
    this.acquired.push(key);
    if (this.refuseAcquire) {
      return Promise.resolve({
        ok: false,
        holder: { actor: "someone", runId: "r", since: NOW() },
      });
    }
    const token = `t${++this.#tokens}`;
    this.held.set(key, token);
    return Promise.resolve({ ok: true, token });
  }
  renewLock(key: string): Promise<boolean> {
    this.renewals.push(key);
    if (this.renewal === "throws") {
      return Promise.reject(new Error("state service had a bad second"));
    }
    return Promise.resolve(this.renewal === "held");
  }
  releaseLock(key: string): Promise<void> {
    this.released.push(key);
    this.held.delete(key);
    return Promise.resolve();
  }
}

/** Give the unref'd heartbeat time to tick at least `ticks` times. */
function afterTicks(ttlMs: number, ticks: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(1000, Math.floor(ttlMs / 2)) * ticks + 60)
  );
}

Deno.test("the default TTL leaves room for an ordinary pause", () => {
  // Not a magic number worth changing casually: it is the window in which a
  // slow step must not be mistaken for a dead process.
  assertEquals(RUN_LEASE_TTL_MS, 60_000);
  assertEquals(RUN_LEASE_PREFIX, "zuke-run");
});

Deno.test("a lease is taken under its prefixed key and released", async () => {
  const store = new LockStore();
  const lease = await acquireLease(store, "zuke-run", "run-1", "me", NOW);
  if (lease === null) throw new Error("expected the lease");
  assertEquals(store.acquired, ["zuke-run-run-1"]);
  assertEquals(lease.lost.aborted, false);
  await lease.release();
  assertEquals(store.released, ["zuke-run-run-1"]);
});

Deno.test("a live holder means no lease", async () => {
  const store = new LockStore();
  store.refuseAcquire = true;
  assertEquals(await acquireLease(store, "zuke-run", "run-1", "me", NOW), null);
});

Deno.test("an explicit refusal from a renewal is loss", async () => {
  // The store says the claim is demonstrably somebody else's, so the holder has
  // to stop rather than keep working alongside whoever took it.
  const store = new LockStore();
  const ttl = 2_000;
  const lease = await acquireLease(
    store,
    "zuke-run",
    "run-1",
    "me",
    NOW,
    ttl,
  );
  if (lease === null) throw new Error("expected the lease");
  store.renewal = "lost";
  await afterTicks(ttl, 1);
  assertEquals(lease.lost.aborted, true);
  assertEquals(lease.lost.reason instanceof Error, true);
  // The heartbeat stops once the claim is gone; there is nothing left to renew.
  const seen = store.renewals.length;
  await afterTicks(ttl, 1);
  assertEquals(store.renewals.length, seen);
  await lease.release();
});

Deno.test("a renewal that throws is not loss", async () => {
  // A filesystem mutex it could not take in time, an HTTP 503, a DNS blip: none
  // of these say who holds the lease, and aborting a healthy build because the
  // state service had a bad second would be the wrong trade entirely.
  const store = new LockStore();
  const ttl = 2_000;
  const lease = await acquireLease(store, "zuke-run", "run-1", "me", NOW, ttl);
  if (lease === null) throw new Error("expected the lease");
  store.renewal = "throws";
  await afterTicks(ttl, 2);
  assertEquals(lease.lost.aborted, false);
  // And it keeps trying, so a blip that passes is simply survived.
  assertEquals(store.renewals.length >= 2, true);
  store.renewal = "held";
  await afterTicks(ttl, 1);
  assertEquals(lease.lost.aborted, false);
  await lease.release();
});

Deno.test("a released lease stops renewing", async () => {
  const store = new LockStore();
  const ttl = 2_000;
  const lease = await acquireLease(store, "zuke-run", "run-1", "me", NOW, ttl);
  if (lease === null) throw new Error("expected the lease");
  await lease.release();
  await afterTicks(ttl, 1);
  assertEquals(store.renewals.length, 0);
});

Deno.test("the cancel lock is the same lease under its own name", async () => {
  // It delegates, so the mechanics live in one place — but its key must not
  // change, or a canceller and the run's own claim would contend for one lock.
  const store = new LockStore();
  const lock = await acquireCancelLock(store, "run-1", "me", NOW);
  if (lock === null) throw new Error("expected the lock");
  assertEquals(store.acquired, ["zuke-cancel-run-1"]);
  await lock.release();
  assertEquals(store.released, ["zuke-cancel-run-1"]);
});

Deno.test("a cancel lock is refused when a live canceller holds it", async () => {
  const store = new LockStore();
  store.refuseAcquire = true;
  assertEquals(await acquireCancelLock(store, "run-1", "me", NOW), null);
});
