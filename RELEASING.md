# Releasing

Zuke publishes five packages to [JSR](https://jsr.io/@zuke) — `@zuke/core`,
`@zuke/deno`, `@zuke/npm`, `@zuke/cmd`, and the `@zuke/cli` command — from a
single workspace. Releases are automated end to end; you only ever merge a
pull request.

## How it works

1. **Conventional commits drive versions.** Land work on `master` with
   Conventional Commits (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:`).
   Because Zuke is pre-1.0, breaking
   changes bump the **minor** version and stay in `0.x`
   (`bump-minor-pre-major`); they do not jump to `1.0.0`.

2. **Zuke runs the whole release.** `.github/workflows/release.yml` is itself
   driven by Zuke: on every push to `master` it runs a single command,
   `./zuke publish` (the launcher installs Deno if the runner lacks it, so the
   workflow has no separate "set up Deno" step). Because `publish` depends on
   `release`, Zuke runs the `release` target first, then publishes.

3. **`release` drives release-please.** The `release` target invokes the
   release-please CLI (`release-pr` + `github-release`). release-please
   maintains a **single** release PR covering every package with pending
   changes, bumping the version in each `packages/<pkg>/deno.json`, updating the
   `CHANGELOG.md`s, and updating `.release-please-manifest.json`. Merging it tags
   each release (`<component>-v<version>`, e.g. `core-v0.1.0`) and cuts the
   GitHub releases.

4. **`publish` pushes to JSR.** The `publish` target walks the packages
   **core first** (so the workspace's `jsr:@zuke/core` dependency resolves) and
   publishes each one whose `deno.json` version is **not yet on JSR** — it
   queries each package's JSR `meta.json` first, so it is idempotent and a
   no-op on pushes that didn't release anything. Authentication is OIDC — the
   JSR package ↔ repo link means **no tokens or secrets** are required; the
   workflow just grants `id-token: write`.

So the steady-state flow is: merge conventional commits → merge the release PR
→ the packages publish themselves.

> [!IMPORTANT]
> **Keep code snippets out of commit message bodies.** release-please parses
> each merged commit with a strict conventional-commits parser, and code
> fragments containing parentheses (for example an arrow-function example) make
> it fail to parse the whole commit — which silently drops it from the release,
> so no version is bumped. Because the repo squash-merges, the squash body is
> built from the PR description/commits, so keep illustrative code in the PR
> *discussion*, not in the commit body. Describe the change in prose instead.

## First release (one-time bootstrap)

The four JSR packages start empty, so the very first release is bootstrapped to
land at exactly `0.1.0`:

- Every package's `deno.json` and `.release-please-manifest.json` are seeded at
  `0.0.0`. `zuke publish` treats `0.0.0` as "not released yet" and skips it, so
  nothing is published until release-please bumps a package to a real version.
- `.release-please-config.json` pins `"release-as": "0.1.0"` per package, so the
  first release is cut at `0.1.0` regardless of commit history.

To cut the first release:

1. Merge this change to `master`. release-please opens a single `0.1.0` release
   PR covering all packages (bumping each `deno.json` from `0.0.0` to `0.1.0`);
   nothing publishes yet.
2. Merge that release PR. `zuke publish` then publishes every package, **core
   first**, in one run.

### Remove the `release-as` pins afterwards

Once all four `0.1.0` versions are on JSR, **delete the `"release-as": "0.1.0"`
lines** from `.release-please-config.json`. They are a one-time bootstrap; if
left in place they would force every future release back to `0.1.0` and break
automatic versioning. After removal, the manifest (now `0.1.0`) becomes the
baseline and conventional commits drive all subsequent versions.

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
