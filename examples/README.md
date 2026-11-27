# Examples

Small, complete projects you can copy into your own repository. Each folder is a
repo in miniature — its own `build.ts`, `zuke.json` and README — and runs from
its own directory with the `zuke` CLI, which finds the `zuke.json` beside the
build and runs it:

```sh
npm install -g @zuke-build/cli   # once
cd examples/node-app
zuke --list                      # what the build can do
zuke                             # run its default target
```

Other ways to install the CLI — Homebrew, Chocolatey, a signed binary — are in
[installing](../docs/install.md).

| Example                                | What it shows                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`deno-library`](./deno-library)       | The everyday gate for a Deno package: format, lint, type-check, test, and a 95% coverage threshold.                       |
| [`canary-release`](./canary-release)   | A canary rollout you can run locally: steps, bakes, an HTTP probe, promotion — and the rollback when the candidate fails. |
| [`ci-only`](./ci-only)                 | A project whose only job is the pipeline: one `cicd()` per provider, generated and verified. Never write CI YAML again.   |
| [`node-app`](./node-app)               | Drive an npm project's install, test and build through `@zuke/npm`, without adding a dependency to it.                    |
| [`release-library`](./release-library) | Release a small library: bump, tag, push, GitHub release with generated notes, publish.                                   |
| [`scripts-to-zuke`](./scripts-to-zuke) | The same `scripts/release.sh` three ways: bash, the `$` shell with no build class, and targets.                           |

Inside this repository the bare `@zuke/*` imports resolve to the workspace, on
Node and on Deno alike, so the examples always match the source you are reading.
`./zuke examplesCheck` type-checks every example, lists its targets and verifies
its pipeline files on every CI run, on Node on Linux, macOS and Windows.

An example carries no `deno.json`, and no `package.json` that declares Zuke:
giving it one would cut it out of the workspace, and the gate would check it
against the _published_ packages instead of the source in this repository. So
when you copy an example, run `zuke setup` in the copy. It adds the `./zuke`
launcher and the manifest that declares `@zuke/core`, and leaves the existing
`build.ts` alone. Then run `zuke add <name>` for each other package the build
imports, such as `zuke add npm`.

Setup keeps the runtime the copy's `zuke.json` names. `node-app` and
`canary-release` say `"runtime": "node"`, so a copy is a Node project with a
`package.json`. `deno-library`, `release-library`, `ci-only` and
`scripts-to-zuke` build Deno code with `DenoTasks`, so their `zuke.json` names
no runtime and a copy stays on Deno, with a `deno.json`. Builds on Deno are
supported until October 2027; `zuke setup --runtime node` moves one to Node.
