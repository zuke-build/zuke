/**
 * A real, runnable Zuke build used by the e2e `killAfter` suite. Run as a
 * subprocess (`deno run -A kill_after_build.ts timeout`), its one target starts a
 * child that **ignores `SIGTERM`** and then sleeps far longer than the test would
 * wait, under a short `killAfter`. A polite terminate alone can never reap that
 * child, so the build only finishes if the timeout escalates to `SIGKILL`.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { $ } from "../../../packages/core/src/shell.ts";

/**
 * The child program: swallow `SIGTERM`, announce itself, then sleep. Windows has
 * no `SIGTERM` listener support, so registering it is best-effort — there the
 * first signal terminates the child and the escalation simply never fires.
 */
const CHILD = [
  `try { Deno.addSignalListener("SIGTERM", () => {}); } catch { /* windows */ }`,
  `console.log("CHILD_UP");`,
  `await new Promise((r) => setTimeout(r, 60000));`,
].join("\n");

/** A build whose single target must be reaped by the timeout, not by the child. */
class KillAfter extends Build {
  /** Runs the `SIGTERM`-proof child; fails with a `CommandTimeoutError`. */
  timeout = target()
    .description("run a SIGTERM-proof child under a short killAfter")
    .executes(async () => {
      await $`${Deno.execPath()} eval ${CHILD}`.quiet().killAfter(200);
    });
}

await run(KillAfter);
