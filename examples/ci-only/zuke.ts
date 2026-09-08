// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Never write CI YAML again.
 *
 * This build's real job is the pipeline: one `cicd()` field per provider, each
 * generated from the same two targets. `deno run -A zuke.ts generate-ci`
 * writes every file; running any target regenerates them; on CI the run
 * verifies the committed copies instead and fails if they have drifted.
 *
 *   deno run -A zuke.ts generate-ci          # write the pipeline files
 *   deno run -A zuke.ts generate-ci --check  # fail if a committed file drifted
 *   deno run -A zuke.ts test                 # the same targets, locally
 */
import { Build, cicd, run, target } from "jsr:@zuke/core@^1";
import { DenoTasks } from "jsr:@zuke/deno@^1";

class Pipeline extends Build {
  // GitHub Actions: one job per target, wired with `needs:` edges that mirror
  // `dependsOn` — independent targets run in parallel on the provider.
  ci = cicd({ provider: "github", fanOut: true });

  // The same pipeline for GitLab and Azure: the provider is the only required
  // field, and the default path follows it (.gitlab-ci.yml, azure-pipelines.yml).
  gitlab = cicd({ provider: "gitlab" });
  azure = cicd({ provider: "azure" });

  lint = target()
    .description("Lint the sources")
    .executes(() => DenoTasks.lint((s) => s.paths(".")));

  test = target()
    .description("Type-check and test")
    .dependsOn(this.lint)
    .executes(() => DenoTasks.test((s) => s.allowAll().paths(".")));

  default = target()
    .description("Default: lint and test")
    .dependsOn(this.test)
    .executes(() => {});
}

await run(Pipeline);
