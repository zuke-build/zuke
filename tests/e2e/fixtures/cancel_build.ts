/**
 * A real, runnable Zuke build used by the e2e cancellation suite. Run as a
 * subprocess (`deno run -A cancel_build.ts <target>`), it deploys (recording a
 * slot in its durable state), then suspends at an approval gate. A separate
 * `cancel <run-id>` invocation stops it and runs the deploy's compensation — so
 * two genuine OS processes exercise cross-process cancellation. `run()` reads
 * `ZUKE_STATE_DIR` from the environment for its durable state.
 *
 * @module
 */

import {
  Build,
  externalSignal,
  run,
  target,
} from "../../../packages/core/mod.ts";

/** A deploy → approval-gate → promote pipeline with a rollback compensation. */
class Cancelable extends Build {
  /** Deploys, recording the slot in durable state, and registers a rollback. */
  deploy = target()
    .executes((ctx) => {
      console.log("DEPLOYED");
      return ctx.state.set({ slot: "sit-7" });
    })
    .onCancel(() => this.rollback);
  /** The compensation: prints the slot it read from the deploy's persisted meta. */
  rollback = target().executes((ctx) =>
    console.log(`ROLLED_BACK:${ctx.state.get().slot}`)
  );
  /** Suspends the run until an `approved` signal is delivered on resume. */
  gate = target()
    .dependsOn(this.deploy)
    .waitsFor((s) => s.on(externalSignal("approved")));
  /** Prints a marker; a cancelled run must never reach this. */
  promote = target().dependsOn(this.gate).executes(() =>
    console.log("PROMOTED")
  );
}

await run(Cancelable);
