# Releasing

Zuke publishes 54 packages to [JSR](https://jsr.io/@zuke) from a single
workspace — `@zuke/core`, the `@zuke/cli` command, a generic `@zuke/cmd`
fallback, and 50+ typed tool wrappers and plugins (`@zuke/deno`, `@zuke/npm`,
`@zuke/ai`, …). Releases are automated end to end; you only ever merge a pull
request.

## How it works

1. **Conventional commits drive versions.** Land work on `master` with
   Conventional Commits (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:`).
   Versions are per-package, and every package is `1.x` on full semver: a
   breaking change bumps the **major** version. `bump-minor-pre-major` is
   **off**, so a package that starts life at `0.x` graduates to `1.0.0` on its
   first breaking change rather than absorbing it into a minor bump.

2. **Zuke runs the whole release.** `.github/workflows/release.yml` is itself
   driven by Zuke: on every push to `master` it runs four least-privilege jobs,
   each invoking one target — `release`, then `actionRelease` and `publishJsr`
   in parallel behind it, then `syncWebsite`. The launcher installs Deno if the
   runner lacks it, so no job needs a separate "set up Deno" step. The split is
   deliberate: `release` needs a `GITHUB_TOKEN` while `publishJsr` needs JSR
   OIDC, and neither job should hold the other's credential. `./zuke publish` is
   the local-only aggregate of `release` + `publishJsr`; CI never runs it.

3. **`release` drives release-please.** The `release` target invokes the
   release-please CLI (`release-pr` + `github-release`). release-please
   maintains a **single** release PR covering every package with pending
   changes, bumping the version in each `packages/<pkg>/deno.json`, updating the
   `CHANGELOG.md`s, and updating `.release-please-manifest.json`. Merging it
   tags each release (`<component>-v<version>`, e.g. `core-v1.30.0`) and cuts
   the GitHub releases.

4. **`publishJsr` pushes to JSR.** The `publishJsr` target walks the packages
   **core first** (so the workspace's `jsr:@zuke/core` dependency resolves) and
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

> [!IMPORTANT]
> **A package that starts using a brand-new `@zuke/core` symbol needs a
> follow-up floor bump.** The workspace only resolves the local `packages/core`
> member while its version still satisfies the dependent's `jsr:@zuke/core@^x.y.z`
> pin, so the PR that introduces the usage **cannot** raise that pin — doing so
> makes Deno ignore the workspace member and try to download a version that is
> not published yet, and the whole build fails to resolve. Land the usage against
> the existing floor, then once the core release publishes, raise the floor in a
> small follow-up `fix:` PR (see `fix: raise the @zuke/core floor to 1.31.0 in
> wrappers using SubcommandSettings`). Until that lands, a consumer whose lockfile
> already resolves the older core can hit a missing-export error, so treat the
> follow-up as part of the change, not optional cleanup.

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
