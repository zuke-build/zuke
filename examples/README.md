# Examples

Small, complete projects you can copy into your own repository. Each folder is a
repo in miniature — its own `zuke.ts`, `zuke.json` and README — and runs from
its own directory with the `zuke` CLI, which finds the `zuke.json` beside the
build and runs it:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once
cd examples/deno-library
zuke --list                                # what the build can do
zuke                                       # run its default target
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

Inside this repository the `jsr:@zuke/*` imports resolve to the workspace, so
the examples always match the source you are reading, and `./zuke examplesCheck`
type-checks every example and lists its targets on every CI run. Copied
elsewhere, the same imports resolve to the published packages.

These inline `jsr:` specifiers are the one place the docs still use them, and
deliberately so: an example carries no `deno.json`, and giving it one would cut
it out of the workspace — Deno then ignores the parent workspace config, and the
gate above would check the examples against the _published_ packages instead of
the source in this repository. Everywhere else, `@zuke/*` is imported by bare
specifier and declared in `deno.json`, because Deno's default lint set rejects
an inline specifier under `no-import-prefix`.

So when you copy an example, run `zuke setup` in the copy. It adds the `./zuke`
launcher and a `deno.json` — including the `imports` entries — and leaves the
existing `zuke.ts` alone; switch its imports to the bare `@zuke/…` form
afterwards and `deno task lint` stays clean.
