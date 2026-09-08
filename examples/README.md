# Examples

Small, complete projects you can copy into your own repository. Each folder is a
repo in miniature — its own `zuke.ts`, `zuke.json` and README — and runs from
its own directory:

```sh
cd examples/deno-library
deno run -A zuke.ts --list   # what the build can do
deno run -A zuke.ts          # run its default target
```

| Example                                | What it shows                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`deno-library`](./deno-library)       | The everyday gate for a Deno package: format, lint, type-check, test, and a 95% coverage threshold.                     |
| [`ci-only`](./ci-only)                 | A project whose only job is the pipeline: one `cicd()` per provider, generated and verified. Never write CI YAML again. |
| [`node-app`](./node-app)               | Drive an npm project's install, test and build through `@zuke/npm`, without adding a dependency to it.                  |
| [`release-library`](./release-library) | Release a small library: bump, tag, push, GitHub release with generated notes, publish.                                 |
| [`scripts-to-zuke`](./scripts-to-zuke) | The same `scripts/release.sh` three ways: bash, the `$` shell with no build class, and targets.                         |

Inside this repository the `jsr:@zuke/*` imports resolve to the workspace, so
the examples always match the source you are reading, and `./zuke examplesCheck`
type-checks every example and lists its targets on every CI run. Copied
elsewhere, the same imports resolve to the published packages.

To add the `./zuke` launcher and a `deno.json` task to a copy, run `zuke setup`
in it — the scaffold leaves an existing `zuke.ts` alone.
