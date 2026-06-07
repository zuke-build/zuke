/**
 * Zuke's own build, authored with Zuke. Demonstrates the v0 authoring API and
 * doubles as a runnable acceptance example.
 *
 *   deno run -A zuke.ts test     # clean → restore → compile → test
 *   deno run -A zuke.ts --list
 */

import { Build, run, target } from "@zuke/core";
import { $ } from "@zuke/core/shell";

class ZukeBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await $`rm -rf dist`;
    });

  restore = target()
    .description("Install dependencies")
    .executes(async () => {
      // No external dependencies in v0; reload the local module graph.
      await $`${Deno.execPath()} cache packages/core/mod.ts`;
    });

  compile = target()
    .description("Type-check the project")
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await $`${Deno.execPath()} check packages/core/mod.ts`;
    });

  test = target()
    .description("Run the test suite")
    .dependsOn(this.compile)
    .executes(async () => {
      await $`${Deno.execPath()} test -A`;
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
