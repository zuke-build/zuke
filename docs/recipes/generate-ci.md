# Recipe: generate your CI and stop editing YAML

For a small project the CI YAML hurts more than the build: it is the one file
nobody can run locally, it drifts from the scripts it calls, and every provider
spells it differently. This recipe declares the pipeline _in_ the build, so
Zuke writes the workflow file, keeps it in sync on every run, and fails CI the
moment the committed copy drifts.

## One line in the build

<!-- check -->

```ts
import { Build, cicd, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class MyBuild extends Build {
  // one line → .github/workflows/ci.yml, one job per target
  ci = cicd({ provider: "github", fanOut: true });

  lint = target().executes(() => DenoTasks.lint());

  test = target()
    .dependsOn(this.lint)
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(MyBuild);
```

```sh
./zuke generate-ci           # write every declared pipeline file
./zuke generate-ci --check   # the CI gate: fail if a committed file drifted
./zuke test                  # the same targets, locally, before you push
```

The provider is the only required field. The default is a workflow named `CI`,
triggered on push and pull request to `main`, with one job that runs `./zuke`;
override only what you need.

## What `generate-ci` writes

For the build above, trimmed to its two jobs:

```yaml
name: CI
"on":
  push:
    branches: [main]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: zuke-build/zuke@7a62523b… # v1.0.1
      - run: ./zuke lint
  test:
    runs-on: ubuntu-latest
    needs: [lint] # ← from .dependsOn(this.lint)
    steps:
      - uses: zuke-build/zuke@7a62523b… # v1.0.1
      - run: ./zuke test
```

Three things to notice:

- **`fanOut: true` turns every target into its own job**, wired with `needs:`
  edges that mirror `dependsOn`. Independent targets run in parallel on the
  provider, and the workflow's shape _is_ the build's graph — a hand-written
  YAML could never stay in sync with it. Leave `fanOut` off for a single job
  that runs the whole build.
- **Every job opens with the SHA-pinned `zuke-build/zuke` action**, which
  hardens the runner and checks the repository out before the target runs. You
  never write that step, and it is never left unpinned.
- **The targets are the same ones you run locally.** There is no second
  definition of "what CI does" to keep aligned by hand.

## Verified, not just generated

Running any target regenerates the declared files, so you cannot forget to. On
CI — Zuke detects `GITHUB_ACTIONS`, `GITLAB_CI`, `TF_BUILD` and Bitbucket's
variables — a run _verifies_ the committed files instead and fails when they
have drifted. `./zuke generate-ci --check` is the same verification as a
dedicated gate, and `--dry-run` skips regeneration altogether.

## One declaration, four providers

The same `cicd()` emits GitHub Actions, GitLab CI, Azure Pipelines, or
Bitbucket Pipelines. Declare one field per provider and every file follows the
same two targets; the default path follows the provider:

<!-- check -->

```ts
import { Build, cicd, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class Pipeline extends Build {
  ci = cicd({ provider: "github", fanOut: true }); // .github/workflows/ci.yml
  gitlab = cicd({ provider: "gitlab" }); // .gitlab-ci.yml
  azure = cicd({ provider: "azure" }); // azure-pipelines.yml
  bitbucket = cicd({ provider: "bitbucket" }); // bitbucket-pipelines.yml

  test = target().executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(Pipeline);
```

Triggers, a matrix, extra steps, permissions, a timezone-aware schedule — the
`pipeline` field takes all of it, once, for every provider. The
[authoring guide](../authoring.md#ci-config-generation--cicd-and-generate-ci)
has the full shape and
[scheduled runs](../schedules.md) covers `{ cron, tz }`. A complete project
whose _only_ job is its pipeline, generated files included, is
[`examples/ci-only`](../../examples/ci-only).
