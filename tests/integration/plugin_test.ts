/**
 * Integration: the enriched plugin lifecycle (M7) driven through the real CLI.
 * A plugin passed to `main()` receives the run id and dry-run flag on every
 * hook, the per-target duration on `onTargetEnd`, and — because `--state` turns
 * on a durable store — `onRunStateChange` on each run-level transition.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, type Plugin, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

Deno.test("a plugin driven through the CLI gets run id, timing, and run-state changes", async () => {
  await withStateDir(async () => {
    const events: string[] = [];
    let runId: string | undefined;
    class B extends Build {
      compile = target().executes(() => {});
    }
    const plugin: Plugin = {
      onStart: (run) => {
        runId = run.runId;
        events.push(`start:${run.dryRun}`);
      },
      onTargetEnd: (n, s, timing) =>
        void events.push(`te:${n}:${s}:${typeof timing.durationMs}`),
      onRunStateChange: (record) => void events.push(`state:${record.status}`),
      onFinish: (_r, run) => void events.push(`finish:${run.runId === runId}`),
    };
    // `--state` turns on the `.zuke/runs` store, so onRunStateChange fires.
    const { code } = await runCli(B, ["compile", "--state"], {
      plugins: [plugin],
    });
    assertEquals(code, 0);
    assertEquals(runId !== undefined && runId !== "", true);
    assertEquals(events, [
      "start:false",
      "state:running",
      "te:compile:passed:number",
      "state:succeeded",
      "finish:true",
    ]);
  });
});
