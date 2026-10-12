# Releasing

Zuke publishes 68 packages to [JSR](https://jsr.io/@zuke) from a single
workspace — `@zuke/core`, the `@zuke/cli` command, a generic `@zuke/cmd`
fallback, and 50+ typed tool wrappers and plugins (`@zuke/deno`, `@zuke/npm`,
`@zuke/ai`, …). Releases are automated end to end; you only ever merge a pull
request.

## How it works

1. **Conventional commits drive versions.** Land work on `master` with
   Conventional Commits (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:`).
   Versions are per-package, and every package is `1.x` on full semver: a
   breaking change bumps the **major** version. `bump-minor-pre-major` is
   **off**, so a breaking change is never absorbed into a minor bump.

   A **new package** is registered at `0.0.0` (manifest and `deno.json`), and
   its first release is `1.0.0`. release-please treats any other manifest
   version as already released, so a package added at `1.0.0` would be first
   released as `1.1.0` — which is how `@zuke/az` and `@zuke/aws` started there.

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

4. **`actionRelease` versions the Marketplace action.** The composite action at
   the repository root releases on its own tag line (`v1`, `v1.0.5`, …),
   separate from the component tags release-please cuts, because it is one
   artifact rather than a package. When `action.yml` has changed since the last
   one, `actionRelease` cuts the next patch tag, moves `v1` onto it, publishes
   the GitHub release with notes derived from the `action.yml` diff, and opens a
   `chore:` PR carrying the updated `build/action_version.json` and the
   workflows regenerated from it.

   It also **reconciles** on every run, not only when it cuts something: any
   `vX.Y.Z` tag without a GitHub release gets one, and `v1` is repointed if it
   drifted. That is deliberate — a release is several writes with nothing
   binding them, and once the tag exists nothing else would ever notice the rest
   going missing. `v1.0.4` and `v1.0.5` sat tagged-but-unreleased for six days,
   which left the repository's "Latest release" pointer on a package release and
   stopped the Gemini extension archive refreshing, with every run green.

   The one step that stays manual is ticking **Publish this Action to the GitHub
   Marketplace**, which GitHub gates behind a 2FA confirmation no token can
   perform. It affects the Marketplace listing only: `uses: zuke-build/zuke@v1`
   resolves through the tag and never consults it.

5. **`publishJsr` pushes to JSR.** The `publishJsr` target walks the packages
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
> member while its version still satisfies the dependent's
> `jsr:@zuke/core@^x.y.z` pin, so the PR that introduces the usage **cannot**
> raise that pin — doing so makes Deno ignore the workspace member and try to
> download a version that is not published yet, and the whole build fails to
> resolve. Land the usage against the existing floor, then once the core release
> publishes, raise the floor in a small follow-up `fix:` PR (see
> `fix: raise the @zuke/core floor to 1.31.0 in
> wrappers using SubcommandSettings`).
> Until that lands, a consumer whose lockfile already resolves the older core
> can hit a missing-export error, so treat the follow-up as part of the change,
> not optional cleanup.
>
> The same holds for a **rich feature package**'s workspace sibling (see
> `PACKAGE_DEPENDENCIES` in `build/packages.ts`): `@zuke/ai` calling a task new
> in `@zuke/gh` lands against gh's current floor, and the floor is raised in a
> follow-up once that gh release publishes. `coreFloorCheck` resolves a sibling
> from the local workspace, so it cannot catch a sibling floor that is too low —
> the follow-up is the control.

## The CLI's standalone binaries

From `@zuke/cli` 1.14.0, every CLI release also ships `deno compile` binaries
for macOS and Linux on its `cli-v<version>` GitHub release, and through the
Homebrew tap
[`zuke-build/homebrew-tap`](https://github.com/zuke-build/homebrew-tap). Five
jobs in `release.yml` do it after `publishJsr`, each running a `cli*` target in
`zuke.ts` (the code is in `build/cli_*.ts`):

1. `cliBinaries` decides what the current CLI version owes from what is
   published — nothing before its release exists, everything while the release
   lacks `SHA256SUMS`, only the tap while the formula points elsewhere — and,
   when binaries are owed, compiles them from the published
   `jsr:@zuke/cli@<version>`.
2. `cliSign` signs the macOS binaries with the Developer ID under the hardened
   runtime and notarizes them, on a macOS runner in the `cli-signing`
   environment. Missing credentials fail it: nothing is published unsigned.
3. `cliUpload` packs the archives, attests their build provenance, and uploads
   them, the attestation bundle, and `SHA256SUMS` last.
4. `cliFormulaVerify` installs the formula built from the published `SHA256SUMS`
   with the real `brew` on macOS and Linux, runs its test, and checks the macOS
   signatures.
5. `cliTap` commits the formula to the tap with the app's token.

Every stage is idempotent, so a run that fails part way is finished by the next
push to master. How users verify a download is in
[docs/install.md](docs/install.md#verifying-a-download).

**Setup, before the first binary release:**

- A `cli-signing` environment holding `APPLE_CERTIFICATE_P12` (the Developer ID
  Application certificate and key, a base64 `.p12`),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_NOTARY_KEY` (the App Store Connect API
  key's `.p8` text), `APPLE_NOTARY_KEY_ID` and `APPLE_NOTARY_ISSUER`. Give it a
  deployment branch rule allowing **only `master`**: the release workflow can
  also be dispatched by hand from any branch, and the rule is what keeps the
  signing secrets away from one. GitHub creates an environment a workflow names
  with no rules at all, so configure it before the first run.
- The `ZUKE_BUILD_APP_*` app installed on `zuke-build/homebrew-tap` with
  contents write access.
- Releases left mutable: assets are attached after release-please publishes a
  release, which an immutable release refuses.

**Recovering a bad release.** Once `SHA256SUMS` is on a release, the binaries
count as published and are not rebuilt. If one turns out to be broken — the
verify job fails on every push — delete `SHA256SUMS` from that release; the next
run rebuilds, re-signs and re-uploads everything, then verifies and republishes
the formula.

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
