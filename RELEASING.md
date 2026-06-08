# Releasing

Zuke publishes four packages to [JSR](https://jsr.io/@zuke) —
`@zuke/core`, `@zuke/deno`, `@zuke/npm`, `@zuke/cmd` — from a single workspace.
Releases are automated end to end; you only ever merge a pull request.

## How it works

1. **Conventional commits drive versions.** Land work on `master` with
   Conventional Commits (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:`).
   Because Zuke is pre-1.0, breaking
   changes bump the **minor** version and stay in `0.x`
   (`bump-minor-pre-major`); they do not jump to `1.0.0`.

2. **Zuke runs the whole release.** `.github/workflows/release.yml` is itself
   driven by Zuke: on every push to `master` it runs a single command,
   `deno task zuke publish`. Because `publish` depends on `release`, Zuke runs
   the `release` target first, then publishes.

3. **`release` drives release-please.** The `release` target invokes the
   release-please CLI (`release-pr` + `github-release`). release-please
   maintains a release PR per package (`separate-pull-requests`), bumping the
   version in `packages/<pkg>/deno.json`, updating the `CHANGELOG.md`, and
   updating `.release-please-manifest.json`. Merging a release PR tags the
   release (`<component>-v<version>`, e.g. `core-v0.1.0`) and cuts the GitHub
   release.

4. **`publish` pushes to JSR.** The `publish` target walks the packages
   **core first** (so the workspace's `jsr:@zuke/core` dependency resolves) and
   publishes each one whose `deno.json` version is **not yet on JSR** — it
   queries each package's JSR `meta.json` first, so it is idempotent and a
   no-op on pushes that didn't release anything. Authentication is OIDC — the
   JSR package ↔ repo link means **no tokens or secrets** are required; the
   workflow just grants `id-token: write`.

So the steady-state flow is: merge conventional commits → merge the release PR
→ the package publishes itself.

## First release (one-time bootstrap)

The four JSR packages start empty, so the very first release is bootstrapped to
land at exactly `0.1.0`:

- Every package's `deno.json` and `.release-please-manifest.json` are seeded at
  `0.0.0`. `zuke publish` treats `0.0.0` as "not released yet" and skips it, so
  nothing is published until release-please bumps a package to a real version.
- `.release-please-config.json` pins `"release-as": "0.1.0"` per package, so the
  first release PR for each is cut at `0.1.0` regardless of commit history.

To cut the first release:

1. Merge this change to `master`. release-please opens four `0.1.0` release PRs
   (bumping each `deno.json` from `0.0.0` to `0.1.0`); nothing publishes yet.
2. **Merge the `core` release PR first** and let it publish. The other three
   import `jsr:@zuke/core@^0`, so core must exist on JSR before they publish.
   (Within a single run `zuke publish` already orders core first; this only
   matters because the PRs are separate.)
3. Merge the `deno`, `npm`, and `cmd` release PRs.

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
