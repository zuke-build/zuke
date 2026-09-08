// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The release routine of a small library, as one chain of targets: test, bump
 * the version, commit, tag, push, cut a GitHub release with generated notes,
 * publish to JSR. Every step is a typed wrapper; nothing is a shell string.
 *
 *   deno run -A zuke.ts --version 1.1.0            # the whole release
 *   deno run -A zuke.ts tag --version 1.1.0        # stop after tagging
 *   deno run -A zuke.ts release --version 1.1.0 --dry-run
 */
import { Build, FileTasks, parameter, run, target } from "jsr:@zuke/core@^1";
import { DenoTasks } from "jsr:@zuke/deno@^1";
import { GhTasks } from "jsr:@zuke/gh@^1";
import { GitTasks } from "jsr:@zuke/git@^1";

class Release extends Build {
  // A typed build input: `--version 1.1.0` on the command line, or the
  // VERSION environment variable. Required, so a missing value is an error
  // before anything runs.
  version = parameter("The version to release, e.g. 1.1.0").required();

  check = target()
    .description("Type-check the public entrypoint")
    .executes(() => DenoTasks.check((s) => s.paths("mod.ts")));

  test = target()
    .description("Run the tests")
    .dependsOn(this.check)
    .executes(() => DenoTasks.test((s) => s.allowAll().paths(".")));

  bump = target()
    .description("Write the version into jsr.json and commit it")
    .dependsOn(this.test)
    .executes(async () => {
      const manifest: Record<string, unknown> = JSON.parse(
        await FileTasks.readText("jsr.json"),
      );
      const bumped = { ...manifest, version: this.version.value };
      await FileTasks.writeText(
        "jsr.json",
        `${JSON.stringify(bumped, null, 2)}\n`,
      );
      await GitTasks.add((s) => s.paths("jsr.json"));
      await GitTasks.commit((s) =>
        s.message(`chore: release ${this.version.value}`)
      );
    });

  tag = target()
    .description("Create the annotated release tag")
    .dependsOn(this.bump)
    .executes(() =>
      GitTasks.tag((s) =>
        s.name(`v${this.version.value}`)
          .message(`Release ${this.version.value}`)
      )
    );

  push = target()
    .description("Push the commit and the tag")
    .dependsOn(this.tag)
    .executes(() => GitTasks.push((s) => s.remote("origin").followTags()));

  release = target()
    .description("Create the GitHub release, with notes generated from the PRs")
    .dependsOn(this.push)
    .executes(() =>
      GhTasks.releaseCreate((s) =>
        s.tag(`v${this.version.value}`).generateNotes().latest()
      )
    );

  publish = target()
    .description("Publish the package to JSR")
    .dependsOn(this.release)
    .executes(() => DenoTasks.publish());

  default = target()
    .description("Default: the whole release")
    .dependsOn(this.publish)
    .executes(() => {});
}

await run(Release);
