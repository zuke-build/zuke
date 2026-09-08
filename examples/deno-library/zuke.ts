// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The everyday gate for a Deno library: format, lint, type-check, test, and a
 * coverage threshold — the pipeline you want on every pull request.
 *
 *   deno run -A zuke.ts            # the whole gate (the default target)
 *   deno run -A zuke.ts test       # one target and what it depends on
 *   deno run -A zuke.ts --list     # every target, with descriptions
 */
import { Build, run, target } from "jsr:@zuke/core@^1";
import { DenoTasks } from "jsr:@zuke/deno@^1";

class Library extends Build {
  format = target()
    .description("Check formatting (deno fmt --check)")
    .executes(() => DenoTasks.fmt((s) => s.check().paths(".")));

  lint = target()
    .description("Lint the sources (deno lint)")
    .executes(() => DenoTasks.lint((s) => s.paths(".")));

  check = target()
    .description("Type-check the public entrypoint")
    .executes(() => DenoTasks.check((s) => s.paths("mod.ts")));

  test = target()
    .description("Run the tests, collecting a coverage profile")
    .dependsOn(this.check)
    .executes(() =>
      DenoTasks.test((s) => s.allowAll().coverage("cov_profile").paths("."))
    );

  coverage = target()
    .description("Fail unless lines and branches are at least 95% covered")
    .dependsOn(this.test)
    .executes(() =>
      DenoTasks.coverage((s) => s.dir("cov_profile").threshold(95))
    );

  // The gate: everything above, each run exactly once, independent targets in
  // parallel when you pass --parallel.
  ci = target()
    .description("The full gate")
    .dependsOn(this.format, this.lint, this.coverage)
    .executes(() => {});

  default = target()
    .description("Default: the full gate")
    .dependsOn(this.ci)
    .executes(() => {});
}

await run(Library);
