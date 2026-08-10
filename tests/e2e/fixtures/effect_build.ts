/**
 * A real, runnable Zuke build used by the effect re-drive e2e suite. Run as a
 * subprocess (`deno run -A effect_build.ts announce`), its one target declares a
 * crash-durable effect that appends a line to a marker file — so the spawning
 * test can count how many times the effect body actually ran across separate OS
 * processes.
 *
 * With `ZUKE_E2E_HANG=1` the effect blocks forever after appending, so the
 * parent can `SIGKILL` it at a point where the intent is durable but the effect
 * has not been recorded as settled. `run()` reads `ZUKE_STATE_DIR` from the
 * environment for its durable state.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";

/** A build whose single target's work is a durable effect. */
class Publish extends Build {
  /** Appends one line per drive, then optionally blocks so it can be killed. */
  announce = target().effect("announce", async (ctx) => {
    const marker = Deno.env.get("ZUKE_E2E_MARKER");
    if (marker === undefined) throw new Error("ZUKE_E2E_MARKER is required");
    await Deno.writeTextFile(
      marker,
      `announce redriven=${ctx.redriven}\n`,
      { append: true },
    );
    console.log("EFFECT-RAN");
    if (Deno.env.get("ZUKE_E2E_HANG") === "1") {
      // Park forever: the parent kills this process here, which is the whole
      // point — the intent is already durable, the settlement never happens.
      await new Promise(() => {});
    }
  });
}

await run(Publish);
