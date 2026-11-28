# Code-first CI and recipes

`cicd()` and complete builds for the common small-project jobs.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **Code-first CI:** `cicd({ provider: "github" })` generates and verifies the
  workflow YAML from the build — deploy jobs included: `environment`, `outputs`,
  sparse `matrixInclude`/`matrixExclude` and per-event
  `pushPaths`/`pullRequestPaths` are typed fields, so no hand-kept YAML is
  needed (a field a provider cannot express is an error, not dropped).

## Code-first CI — `cicd()`

```ts
ci = cicd({ provider: "github" }); // .github/workflows/ci.yml, push/PR to main
```

`provider` is the only required field (`"github"` / `"gitlab"` / `"azure"` /
`"bitbucket"`). Running any target regenerates the YAML; on CI it _verifies_ the
committed file is current (`zuke generate-ci --check` is a dedicated gate).

**Scheduled runs** — `triggers.schedule: [{ cron, tz? }]`. A `tz` (IANA zone) is
compiled to UTC cron(s); a daylight-saving zone also emits a generated guard job
so only the correct wall-clock firing proceeds. Full on GitHub; Azure gets
native `schedules:` for UTC/fixed-offset (DST zone errors); GitLab/Bitbucket
schedules are UI-side and ignored. Numeric fields + whole-hour offsets only,
else a friendly error. `cicd({ provider: "github", pipeline: { triggers: {
schedule: [{ cron: "30 9 * * 1-5", tz: "Europe/Sofia" }] } } })`.

**Deploy jobs, outputs, sparse matrices, path filters** — on a job or an
`invokes` entry: `environment: "prod" | { name, url }` (the deployment
environment that protection rules and environment secrets attach to — not
`env`), `outputs: { name: "${{ steps.x.outputs.y }}" }` (read downstream as `${{
needs.<job>.outputs.<name> }}`), `matrixInclude`/`matrixExclude` rows (GitHub
semantics; include-only rows are the whole matrix). On triggers:
`pushPaths`/`pullRequestPaths: { paths } | { pathsIgnore }`, each needing its
trigger. A field a provider cannot express is an error, never dropped: `outputs`
is GitHub-only, `environment` GitHub/GitLab, `pathsIgnore` GitHub/Azure, `paths`
everywhere but Bitbucket. A path-filtered workflow leaves required checks
pending when it skips.

## Recipes — complete builds for the common small-project jobs

Copy the closest one instead of composing from primitives; each is a full
`build.ts` with the commands to run it, and has a runnable twin under
`examples/`:

- **Replace a shell script**
  ([`docs/recipes/replace-shell-scripts.md`](https://github.com/zuke-build/zuke/blob/master/docs/recipes/replace-shell-scripts.md),
  `examples/scripts-to-zuke`) — `$` from `@zuke/core/shell` with no `Build`
  class at all, then the same steps as targets.
- **Generate the CI**
  ([`docs/recipes/generate-ci.md`](https://github.com/zuke-build/zuke/blob/master/docs/recipes/generate-ci.md),
  `examples/ci-only`) — `cicd({ provider, fanOut: true })` per provider,
  `generate-ci --check` as the gate.
- **Release a library**
  ([`docs/recipes/release-a-library.md`](https://github.com/zuke-build/zuke/blob/master/docs/recipes/release-a-library.md),
  `examples/release-library`) — `parameter().required()` version, then
  `GitTasks.add/commit/tag/push` → `GhTasks.releaseCreate((s) =>
  s.generateNotes().latest())` → `DenoTasks.publish()`, one chain you can stop
  anywhere.
