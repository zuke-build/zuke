// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../run_lock_e2e.ts}: a rollout that holds a
 * run-held lock across a suspend, and a hotfix that contends for it. Every
 * invocation is its own `deno` process; the `ZUKE_STATE_DIR` the test provides
 * is the only thing they share. `ZUKE_E2E_LOCK_TTL` sets the lock's TTL, so a
 * test can let a parked run's lock lapse.
 *
 * @module
 */

import {
  Build,
  externalSignal,
  run,
  target,
} from "../../../packages/core/mod.ts";

/** The run-held lock's TTL. */
const TTL = Deno.env.get("ZUKE_E2E_LOCK_TTL") ?? "1h";

class RunLockBuild extends Build {
  stage = target()
    .description("stage the candidate and take the service for the whole run")
    .lock((s) => s.lockKey("deploy", "api").withTtl(TTL).holdForRun())
    .executes(() => console.log("STAGED"));

  approve = target()
    .description("wait for approval")
    .dependsOn(this.stage)
    .waitsFor((s) => s.on(externalSignal("approved")));

  promote = target()
    .description("promote the candidate")
    .dependsOn(this.approve)
    .executes(() => console.log("PROMOTED"));

  hotfix = target()
    .description("patch the same service, which a rollout must keep out")
    .lock((s) => s.lockKey("deploy", "api").withTtl("1h"))
    .executes(() => console.log("PATCHED"));
}

await run(RunLockBuild);
