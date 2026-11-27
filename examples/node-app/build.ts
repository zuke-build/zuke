// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A Node project driven by Zuke. Node runs the build too, and the typed
 * `@zuke/npm` wrapper drives the app's own npm scripts and toolchain.
 *
 *   zuke                   # install → test → build → pack
 *   zuke test              # just install → test
 *   npm run zuke -- --list # the same, for npm-centric colleagues
 */
import { Build, run, target } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";

class App extends Build {
  install = target()
    .description("Clean-install dependencies from the lockfile (npm ci)")
    .executes(() => NpmTasks.ci());

  test = target()
    .description("Run the app's test script (npm test)")
    .dependsOn(this.install)
    .executes(() => NpmTasks.test());

  build = target()
    .description("Run the app's build script (npm run build)")
    .dependsOn(this.test)
    .executes(() => NpmTasks.run((s) => s.script("build")));

  pack = target()
    .description("Verify the publishable tarball (npm pack --dry-run)")
    .dependsOn(this.build)
    .executes(() => NpmTasks.pack((s) => s.dryRun()));

  default = target()
    .description("Default: install → test → build → pack")
    .dependsOn(this.pack)
    .executes(() => {});
}

await run(App);
