/**
 * Zuke's own build, authored with Zuke. Demonstrates the v0 authoring API and
 * doubles as a runnable acceptance example — including the typed tool
 * wrappers (`DenoTasks`) and the generic fallback (`CmdTasks`).
 *
 *   deno run -A zuke.ts test     # clean → restore → compile → test
 *   deno run -A zuke.ts --list
 */

import { Build, run, target } from "@zuke/core";
import { CmdTasks } from "@zuke/cmd";
import { DenoTasks } from "@zuke/deno";

class ZukeBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await CmdTasks.exec("rm", (s) => s.args("-rf", "dist"));
    });

  restore = target()
    .description("Install dependencies")
    .executes(async () => {
      // No external dependencies in v0; reload the local module graph.
      await DenoTasks.cache((s) => s.paths("packages/core/mod.ts"));
    });

  compile = target()
    .description("Type-check the project")
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await DenoTasks.check((s) => s.paths("packages/core/mod.ts"));
    });

  test = target()
    .description("Run the test suite")
    .dependsOn(this.compile)
    .executes(async () => {
      await DenoTasks.test((s) => s.allowAll());
    });

  // Convention: the `default` target runs when none is named.
  default = target()
    .description("Default: run the full test pipeline")
    .dependsOn(this.test)
    .executes(() => {});
}

if (import.meta.main) {
  await run(ZukeBuild);
}
