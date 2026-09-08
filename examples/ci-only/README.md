# ci-only

For a small project the CI YAML hurts more than the build. This example is a
project whose whole reason to have a `zuke.ts` is the pipeline: two targets and
three `cicd()` declarations, one per provider, all generated from the same
source.

```sh
deno run -A zuke.ts generate-ci          # writes the three files below
deno run -A zuke.ts generate-ci --check  # the CI gate: fail if one drifted
deno run -A zuke.ts test                 # run the same targets locally
```

| Field    | Provider        | Written to                                               |
| -------- | --------------- | -------------------------------------------------------- |
| `ci`     | GitHub Actions  | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |
| `gitlab` | GitLab CI       | [`.gitlab-ci.yml`](./.gitlab-ci.yml)                     |
| `azure`  | Azure Pipelines | [`azure-pipelines.yml`](./azure-pipelines.yml)           |

The committed files are exactly what the build generates. What to notice:

- `fanOut: true` on the GitHub file turns each target into its own job. The
  `test` job carries `needs: [lint]` because `test` declares
  `.dependsOn(this.lint)` — the workflow's shape is the build's graph, and a
  hand-written YAML could never stay in sync with it.
- Every job opens with the `zuke-build/zuke` action, SHA-pinned, which hardens
  the runner and checks out the repository before the target runs.
- Running any target regenerates the files, so you cannot forget to. On CI
  (`GITHUB_ACTIONS`, `GITLAB_CI`, and the rest are detected) the run verifies
  the committed files instead and fails on drift.
- Bitbucket Pipelines is the fourth provider; add
  `bitbucket = cicd({ provider: "bitbucket" })` and regenerate.
