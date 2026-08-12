# Security Policy

Zuke is a build-automation framework, so it runs inside other people's pipelines
and publishes itself to a public registry. Supply-chain integrity is therefore
the primary concern, and this document describes how the project is hardened and
how to report problems.

> Zuke is largely AI-written (see the README). Review before you rely on it.
> Every package is `1.x` on full semver; depend on the caret range
> (`jsr:@zuke/core@^1`) rather than an exact version, so patch fixes reach you —
> see [Versioning & compatibility](./docs/versioning.md).

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Use GitHub's **"Report a vulnerability"** button under the repository's
  **Security** tab (Private Vulnerability Reporting). This opens a private
  advisory visible only to you and the maintainers.
- Include affected version(s), reproduction steps, and impact. A minimal proof
  of concept helps us triage quickly.

We aim to acknowledge a report within a few days and to coordinate a fix and
disclosure timeline with you. Fixes ship in a new release; the advisory is
published once a patched version is available.

**Credit:** reporters are credited by name in the published advisory (and in the
release notes of the fix) unless they ask to remain anonymous.

## Supported versions

Only the **latest** published version of each `@zuke/*` package receives
security fixes. Depending on the caret range keeps you on it.

## Supply-chain posture

What the project does to keep releases trustworthy:

- **Zero runtime dependencies.** Every published package declares no dependency
  but `@zuke/core`, so nothing third-party is shipped to consumers. The build
  layer is separate and does have them: `@std/yaml` for `build/`, `cspell` and
  `release-please` installed from npm on demand, and four checksum-verified
  binaries (the Codecov CLI, zizmor, actionlint, gitleaks) provisioned by the
  build's `toolchain()`. All of it is dev/release-time only.
- **Injection-free command execution.** All process execution goes through
  `Deno.Command` with a discrete argv array — there is no shell string, so
  interpolated values can never be reinterpreted as shell syntax.
- **Trusted publishing via OIDC.** Packages publish to JSR with a short-lived
  OIDC token (`id-token: write`); no long-lived registry tokens or secrets are
  stored. JSR records build **provenance** for each published version.
- **Least-privilege CI.** The default workflow token is `contents: read`. The
  release pipeline is split so the `release` job (`contents` /
  `pull-requests: write`) and the `publishJsr` job (`id-token: write`) never
  hold each other's privileges.
- **Pinned, monitored Actions.** Every GitHub Action is pinned to a full commit
  SHA, with a version comment kept current by Dependabot. Every job that holds a
  write-scoped token runs `step-security/harden-runner` with an
  `egress-policy: block` allowlist, so outbound access is enforced rather than
  merely audited. The `test` job in `ci.yml` is the exception: it holds no token
  and only runs the test suite.
- **Pinned toolchain.** The `./zuke` launcher bootstraps a **pinned** Deno
  version, so CI and local builds install a known version rather than a moving
  `latest`. Dependencies are resolved against a committed `deno.lock`, enforced
  with `--frozen`. The scanner CLIs are pinned and checksum-verified in
  `build/scanners.ts` and provisioned by the build itself, so the security
  workflow needs no install step and nothing has to be present on `PATH`.
- **Scanning via Zuke.** The supply-chain scanners run as a typed Zuke build
  target — `./zuke security` drives zizmor (Actions SAST), actionlint, and
  gitleaks (secrets) through [`@zuke/security`](./packages/security), failing
  the build on findings. (The package also wraps osv-scanner, semgrep, and Trivy
  for consumers whose projects have lockfiles/manifests those tools support.)
  Code-level SARIF for the GitHub Security tab comes from CodeQL, run by the
  committed [`codeql.yml`](./.github/workflows/codeql.yml) workflow on every
  pull request, push to master, and a weekly schedule — analyzing the TypeScript
  sources and, via the `actions` query pack, the workflow YAML itself — and from
  OpenSSF Scorecard, which runs as a native action workflow.

### Known trade-offs

- **Bootstrap launchers.** `./zuke` and `./zuke.ps1` install Deno on first use
  by downloading the pinned release archive from GitHub and verifying it against
  a per-platform SHA-256 baked into the launcher. No install script is fetched
  or executed. `DENO_VERSION=latest` is **refused** — a moving target has no
  checksum to pin — and overriding the version requires supplying a matching
  `DENO_SHA256`, so the launcher never runs an unverified binary. To skip the
  bootstrap entirely, install Deno yourself so the launcher finds it on `PATH`.
- **`deno publish --allow-dirty`.** The publish step currently allows a dirty
  tree as a backstop. The merged release tree should already be clean; once a
  real release confirms this, drop the flag for the strongest "published ==
  committed source" guarantee.
- **`contents: write` + `persist-credentials` on the `ci` job.** The `ci` job in
  `ci.yml` runs on `pull_request` with `contents: write` and
  `actions/checkout`'s `persist-credentials: true`, because the AI lint fixer
  may push a fix commit back to the PR branch. This is a deliberate trade-off,
  and it is fork-safe: `pull_request` (not `pull_request_target`) runs with the
  base repository's read-only `GITHUB_TOKEN` for a fork PR, so the elevated
  write and persisted credential apply only to same-repository branches, never
  to code a fork controls. Workflow egress is audited by
  `step-security/harden-runner`.

## Verifying a release

Every published `@zuke/*` version can be verified against this repository:

- **Provenance (signature).** Packages are published to JSR via OIDC trusted
  publishing, and JSR records a [Sigstore](https://www.sigstore.dev/) provenance
  attestation for each version — signed by the release workflow's short-lived
  OIDC identity, so there is no long-lived private key anywhere, let alone on
  the distribution site. To verify, open the version on
  [jsr.io](https://jsr.io/@zuke/core) and check its **provenance** panel: it
  names this repository, the exact commit, and the workflow run that published
  it. A version without provenance, or with provenance naming another
  repository, should be treated as compromised and reported (see above).
- **Source equality.** The published artifacts are the committed source files
  (there is no build/compile step), so a version's contents can be diffed
  directly against its provenance-named commit.
- **Launcher downloads.** The `./zuke` / `zuke.ps1` launchers verify the Deno
  archive they bootstrap against a per-platform SHA-256 baked into the launcher,
  as described under "Known trade-offs".

Git tags are created by release-please through the GitHub API and are **not**
GPG-signed; the provenance attestation above is the release signature to rely
on.

## Running the scanners yourself

The same scanners are exposed as Zuke tasks via
[`@zuke/security`](./packages/security), so any consumer can run them in their
own pipeline:

```ts
import { SecurityTasks } from "jsr:@zuke/security";

await SecurityTasks.zizmor((s) => s.paths(".github/workflows"));
await SecurityTasks.osvScanner((s) => s.lockfile("package-lock.json"));
```

In this repository, `deno task zuke security` runs the bundled set (zizmor,
actionlint, gitleaks); the target provisions each one itself, so nothing needs
to be installed on `PATH` first.

## Recommended repository settings

These cannot be set from files in the repo; configure them in GitHub settings:

- **Branch protection on `master`:** require a pull request with at least one
  review, require CODEOWNER review, require status checks (CI, CodeQL) to pass,
  dismiss stale approvals on new commits, and disallow force-pushes.
- **Restrict release-PR merges** to maintainers.
- **Keep CodeQL _code scanning_ default setup OFF.** The committed
  [`codeql.yml`](./.github/workflows/codeql.yml) is the advanced configuration
  and the single source of code-scanning analysis; enabling default setup for
  the same language makes GitHub reject the workflow's SARIF uploads. The
  GitHub-managed **Code Quality** analysis is a separate feature and can stay
  enabled alongside it.
- **Enable secret scanning and push protection** (free for public repos).
- **Require 2FA** for all maintainers, on both GitHub and JSR.
- **Scope the JSR ↔ repo OIDC link** so publishing is allowed only from this
  repository's release workflow.
