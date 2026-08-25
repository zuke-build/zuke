// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: a target that waits for a cross-run lock has to wait for a lock
 * held by *another process*, which is the case the feature exists for. Two real
 * runs share nothing but a state directory: one takes the lock and keeps it,
 * the other queues and gets in once the first is done.
 *
 * The in-process test proves the retry loop; only this one proves it against a
 * holder the waiter cannot see, renew, or release.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runFixture, spawnFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/lock_wait_build.ts", import.meta.url);

/** How long the holder keeps the lock. */
const HOLD_MS = 3_000;

/** How long the waiter is given before it is considered stuck. */
const START_DELAY_MS = 500;

Deno.test("a run waits for a lock another process holds", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "zuke-lock-e2e-" });
  const env = { ZUKE_STATE_DIR: stateDir, ZUKE_E2E_HOLD_MS: String(HOLD_MS) };
  try {
    const holder = spawnFixture(FIXTURE, ["hold"], env);
    // Give the holder time to reach its body and take the lock.
    await new Promise((resolve) => setTimeout(resolve, START_DELAY_MS));

    const started = performance.now();
    const waiter = await runFixture(FIXTURE, ["wait"], env);
    const elapsed = performance.now() - started;
    const holderRun = await holder.output();
    const holderOut = new TextDecoder().decode(holderRun.stdout);
    const output = waiter.out + waiter.err;

    assertEquals(holderOut.includes("HOLDER_OUT"), true, holderOut);
    assertEquals(waiter.code, 0, `expected the waiter to succeed:\n${output}`);
    assertEquals(waiter.out.includes("WAITER_IN"), true, output);
    // It said what it was waiting on rather than sitting there silently.
    assertEquals(
      waiter.out.includes(`Waiting for lock "dev-env"`),
      true,
      output,
    );
    // And it really waited for the holder rather than taking the lock early.
    assertEquals(
      elapsed > HOLD_MS - START_DELAY_MS,
      true,
      `the waiter got in after ${Math.round(elapsed)}ms, too early to have ` +
        `waited for a ${HOLD_MS}ms holder`,
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
