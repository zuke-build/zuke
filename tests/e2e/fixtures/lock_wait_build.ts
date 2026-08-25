// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../lock_wait_e2e.ts}: two real processes contending
 * for one cross-run lock. `hold` takes it and keeps it for `ZUKE_E2E_HOLD_MS`;
 * `wait` queues for it and prints when it got in. Both run against the
 * `ZUKE_STATE_DIR` the test provides, which is the only thing they share.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";

/** How long the holder keeps the lock, in milliseconds. */
const HOLD_MS = Number(Deno.env.get("ZUKE_E2E_HOLD_MS") ?? "2000");

class LockWaitBuild extends Build {
  hold = target()
    .description("take the shared lock and keep it for a while")
    .lock((s) => s.lockKey("dev-env").withTtl("1h"))
    .executes(async () => {
      console.log("HOLDER_IN");
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      console.log("HOLDER_OUT");
    });

  wait = target()
    .description("queue for the shared lock rather than failing")
    .lock((s) =>
      s.lockKey("dev-env").withTtl("1h").waitUpTo("60s").pollEvery("100ms")
    )
    .executes(() => {
      console.log("WAITER_IN");
    });
}

await run(LockWaitBuild);
