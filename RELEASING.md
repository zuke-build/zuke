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

   Nothing is left to do by hand. The Marketplace listing reads the repository's
   "Latest release" pointer, which that published release sets, so the new
   version shows there on its own. Ticking **Publish this Action to the GitHub
   Marketplace** — the step GitHub gates behind a 2FA confirmation — was needed
   once to create the listing and is only needed again to re-create one that was
   taken down. `uses: zuke-build/zuke@v1` never consults the listing either way:
   it resolves through the tag.

5. **`publishJsr` pushes to JSR.** The `publishJsr` target walks the packages
   **core first** (so the workspace's `jsr:@zuke/core` dependency resolves) and
   publishes each one whose `deno.json` version is **not yet on JSR** — it
   queries each package's JSR `meta.json` first, so it is idempotent and a no-op
   on pushes that didn't release anything. A package that does not land — a JSR
   task left pending, a rejected upload — fails the job, but only after the walk
   has tried every other package: the ones that do not depend on it still
   publish, and the job's error names every version that is missing. Re-run the
   job once the cause is fixed. Authentication is OIDC — the JSR package ↔ repo
   link means **no tokens or secrets** are required; the workflow just grants
   `id-token: write`.

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
[`zuke-build/homebrew-tap`](https://github.com/zuke-build/homebrew-tap); from
1.15.1, a Windows binary too, through Chocolatey.

Releases are **immutable**: once published, nothing can be added to one or
changed. So release-please cuts the CLI's release as a **draft**
(`"draft": true` for `packages/cli` in `.release-please-config.json`), the
pipeline attaches everything to the draft, and publishing it is the last step,
which locks the release with its binaries already inside. The jobs in
`release.yml` run after `publishJsr`, each running a `cli*` target in `zuke.ts`
(the code is in `build/cli_*.ts`):

1. `cliBinaries` decides what the current CLI version owes from what is
   published — everything while its release is unpublished, only the tap or the
   Chocolatey package while either lags behind a published release — and, when
   binaries are owed, compiles them from the published
   `jsr:@zuke/cli@<version>`.
2. `cliSign` signs the macOS binaries with the Developer ID under the hardened
   runtime and notarizes them, on a macOS runner in the `cli-signing`
   environment. Missing credentials fail it: nothing is published unsigned.
3. `cliUpload` packs the archives, attests their build provenance, attaches
   them, the attestation bundle and `SHA256SUMS` to the draft with
   `gh release upload --clobber`, then publishes it with
   `gh release edit --draft=false --latest=false` (the "Latest release" pointer
   stays on the Marketplace action's release).
4. `cliFormulaVerify` installs the formula built from the published `SHA256SUMS`
   with the real `brew` on macOS and Linux, runs its test, and checks the macOS
   signatures.
5. `cliTap` commits the formula to the tap with the app's token.
6. `cliChocolateyVerify` installs the Chocolatey package built from the
   published `SHA256SUMS` with the real `choco` on Windows and runs it.
7. `cliChocolatey` pushes the package to the community repository with
   `CHOCOLATEY_API_KEY`, held in the `chocolatey` environment. The Windows
   executable is not Authenticode-signed yet (#793).

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
- A `chocolatey` environment holding `CHOCOLATEY_API_KEY`, with the same
  deployment branch rule.

**Recovering a bad release.** Until the release is published, every push to
master retries: the draft takes the assets again, replacing what is there. Once
it is published it cannot change, so a broken binary is fixed by the next CLI
release, not by editing this one. A release published without its binaries
(`cli-v1.15.0`, cut before the draft flow) is skipped with a note in the log,
for the same reason.

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
