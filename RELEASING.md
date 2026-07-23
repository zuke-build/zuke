# Releasing

Zuke publishes 55 packages to [JSR](https://jsr.io/@zuke) from a single
workspace — `@zuke/core`, the `@zuke/cli` command, a generic `@zuke/cmd`
fallback, and 50+ typed tool wrappers and plugins (`@zuke/deno`, `@zuke/npm`,
`@zuke/ai`, …). Releases are automated end to end; you only ever merge a pull
request.

## How it works

1. **Conventional commits drive versions.** Land work on `master` with
   Conventional Commits (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:`).
   Versions are per-package. `bump-minor-pre-major` is enabled, so a package
   still in `0.x` (most tool wrappers) takes a **minor** bump on a breaking
   change and stays in `0.x`. Packages that have reached 1.0 — `@zuke/core`,
   plus `@zuke/ai`, `@zuke/console`, `@zuke/otel`, and others — follow full
   semver: a breaking change bumps the **major** version.

2. **Zuke runs the whole release.** `.github/workflows/release.yml` is itself
   driven by Zuke: on every push to `master` it runs a single command,
   `./zuke publish` (the launcher installs Deno if the runner lacks it, so the
   workflow has no separate "set up Deno" step). Because `publish` depends on
   `release`, Zuke runs the `release` target first, then publishes.

3. **`release` drives release-please.** The `release` target invokes the
   release-please CLI (`release-pr` + `github-release`). release-please
   maintains a **single** release PR covering every package with pending
   changes, bumping the version in each `packages/<pkg>/deno.json`, updating the
   `CHANGELOG.md`s, and updating `.release-please-manifest.json`. Merging it
   tags each release (`<component>-v<version>`, e.g. `core-v1.30.0`) and cuts
   the GitHub releases.

4. **`publish` pushes to JSR.** The `publish` target walks the packages **core
   first** (so the workspace's `jsr:@zuke/core` dependency resolves) and
   publishes each one whose `deno.json` version is **not yet on JSR** — it
   queries each package's JSR `meta.json` first, so it is idempotent and a no-op
   on pushes that didn't release anything. Authentication is OIDC — the JSR
   package ↔ repo link means **no tokens or secrets** are required; the workflow
   just grants `id-token: write`.

So the steady-state flow is: merge conventional commits → merge the release PR →
the packages publish themselves.

> [!IMPORTANT]
> **Keep code snippets out of commit message bodies.** release-please parses
> each merged commit with a strict conventional-commits parser, and code
> fragments containing parentheses (for example an arrow-function example) make
> it fail to parse the whole commit — which silently drops it from the release,
> so no version is bumped. Because the repo squash-merges, the squash body is
> built from the PR description/commits, so keep illustrative code in the PR
> _discussion_, not in the commit body. Describe the change in prose instead.

## Manual trigger

`release.yml` also has a `workflow_dispatch` trigger, so you can run
release-please on demand from the Actions tab without waiting for a push.

## Running the build locally

The same targets the workflows use are runnable locally:

```sh
deno task zuke ci      # the full gate CI runs
deno task zuke test    # type-check + tests
deno task zuke --list  # every target
```
