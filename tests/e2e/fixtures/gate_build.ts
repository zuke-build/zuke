/**
 * A real, runnable Zuke build used by the e2e race suite. Run as a subprocess
 * (`deno run -A gate_build.ts <target>`), it suspends at an approval gate and is
 * resumed by a separate `resume` invocation — so two genuine OS processes can
 * race the same run's compare-and-swap. `run()` reads `ZUKE_STATE_DIR` from the
 * environment for its durable state.
 *
 * @module
 */

import {
  Build,
  externalSignal,
  run,
  target,
} from "../../../packages/core/mod.ts";

/** A deploy → approval-gate → promote pipeline. */
class Gate extends Build {
  /** Prints a marker so the spawning test can confirm it ran. */
  deploy = target().executes(() => console.log("DEPLOYED"));
  /** Suspends the run until an `approved` signal is delivered on resume. */
  gate = target()
    .dependsOn(this.deploy)
    .waitsFor((s) => s.on(externalSignal("approved")));
  /** Prints a marker; exactly one racing resumer should reach this. */
  promote = target().dependsOn(this.gate).executes(() =>
    console.log("PROMOTED")
  );
}

await run(Gate);
