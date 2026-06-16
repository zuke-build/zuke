# Security Policy

Zuke is a build-automation framework, so it runs inside other people's
pipelines and publishes itself to a public registry. Supply-chain integrity is
therefore the primary concern, and this document describes how the project is
hardened and how to report problems.

> Zuke is pre-1.0 and largely AI-written (see the README). Review before you
> rely on it, and prefer pinning to an exact version in your own builds.

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

## Supported versions

While the project is pre-1.0, only the **latest** published version of each
`@zuke/*` package receives security fixes.

## Supply-chain posture

What the project does to keep releases trustworthy:

- **Zero runtime dependencies.** The library is dependency-free; the only
  third-party tooling (`cspell`, `release-please`) is dev/release-time, pinned,
  and never shipped to consumers.
- **Injection-free command execution.** All process execution goes through
  `Deno.Command` with a discrete argv array — there is no shell string, so
  interpolated values can never be reinterpreted as shell syntax.
- **Trusted publishing via OIDC.** Packages publish to JSR with a short-lived
  OIDC token (`id-token: write`); no long-lived registry tokens or secrets are
  stored. JSR records build **provenance** for each published version.
- **Least-privilege CI.** The default workflow token is `contents: read`. The
  release pipeline is split so the `release-please` job (`contents` /
  `pull-requests: write`) and the JSR `publish` job (`id-token: write`) never
  hold each other's privileges.
- **Pinned, monitored Actions.** Every GitHub Action is pinned to a full commit
  SHA (with a version comment, kept current by Dependabot), and every job runs
  `step-security/harden-runner` to audit outbound network egress.
- **Pinned toolchain.** The `./zuke` launcher bootstraps a **pinned** Deno
  version by default (override with `DENO_VERSION`), so CI and local builds
  install a known version rather than a moving `latest`. Dependencies are
  resolved against a committed `deno.lock`, enforced with `--frozen`, and the
  scanner CLIs are pinned to exact versions in the security workflow.
- **Scanning via Zuke.** The supply-chain scanners run as a typed Zuke build
  target — `./zuke security` drives zizmor (Actions SAST), actionlint, and
  gitleaks (secrets) through [`@zuke/security`](./packages/security), failing
  the build on findings. (The package also wraps osv-scanner, semgrep, and
  Trivy for consumers whose projects have lockfiles/manifests those tools
  support.) Code-level SARIF for the GitHub Security tab comes from CodeQL
  (TypeScript) and OpenSSF Scorecard, which have no CLI to wrap and stay as
  native actions.

### Known trade-offs

- **Bootstrap launchers.** `./zuke` and `./zuke.ps1` install Deno on first use
  via the official `https://deno.land` install script (`curl … | sh`). The
  version is pinned by default (set `DENO_VERSION=latest` or a specific version
  to override), and `step-security/harden-runner` audits runner egress, but the
  install *script itself* is fetched at run time. To avoid it entirely, install
  Deno yourself so the launcher finds it on `PATH`.
- **`deno publish --allow-dirty`.** The publish step currently allows a dirty
  tree as a backstop. The merged release tree should already be clean; once a
  real release confirms this, drop the flag for the strongest
  "published == committed source" guarantee.

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
actionlint, gitleaks) once the tools are installed on `PATH`.

## Recommended repository settings

These cannot be set from files in the repo; configure them in GitHub settings:

- **Branch protection on `master`:** require a pull request with at least one
  review, require CODEOWNER review, require status checks (CI, CodeQL) to pass,
  dismiss stale approvals on new commits, and disallow force-pushes.
- **Restrict release-PR merges** to maintainers.
- **Enable secret scanning and push protection** (free for public repos).
- **Require 2FA** for all maintainers, on both GitHub and JSR.
- **Scope the JSR ↔ repo OIDC link** so publishing is allowed only from this
  repository's release workflow.
