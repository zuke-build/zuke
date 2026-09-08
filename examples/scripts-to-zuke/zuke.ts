// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The third form of scripts/release.sh: the same steps as targets. Each step
 * is now something you can run on its own, see in `--list`, and depend on —
 * and the two git steps use the typed wrapper instead of `$`.
 *
 *   deno run -A zuke.ts --version 1.1.0         # clean → test → tag → push
 *   deno run -A zuke.ts tag --version 1.1.0     # stop after the tag
 *   deno run -A zuke.ts --list
 */
import { Build, parameter, run, target } from "jsr:@zuke/core@^1";
import { $ } from "jsr:@zuke/core@^1/shell";
import { DenoTasks } from "jsr:@zuke/deno@^1";
import { GitTasks } from "jsr:@zuke/git@^1";

class Release extends Build {
  version = parameter("The version to release, e.g. 1.1.0").required();

  clean = target()
    .description("Refuse to release from a dirty working tree")
    .executes(async () => {
      // `$` still works inside a target — handy for a one-off command that
      // has no wrapper, or before you have looked for one.
      const dirty = await $`git status --porcelain`.quiet().text();
      if (dirty !== "") throw new Error("the working tree is not clean");
    });

  test = target()
    .description("Run the tests")
    .dependsOn(this.clean)
    .executes(() => DenoTasks.test((s) => s.allowAll().paths(".")));

  tag = target()
    .description("Create the annotated release tag")
    .dependsOn(this.test)
    .executes(() =>
      GitTasks.tag((s) =>
        s.name(`v${this.version.value}`)
          .message(`Release ${this.version.value}`)
      )
    );

  push = target()
    .description("Push the tag")
    .dependsOn(this.tag)
    .executes(() => GitTasks.push((s) => s.remote("origin").followTags()));

  default = target()
    .description("Default: the whole release")
    .dependsOn(this.push)
    .executes(() => {});
}

await run(Release);
