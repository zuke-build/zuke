# Security Policy

Zuke is a build-automation framework, so it runs inside other people's pipelines
and publishes itself to a public registry. Supply-chain integrity is therefore
the primary concern, and this document describes how the project is hardened and
how to report problems.

> Zuke is largely AI-written (see the README). Review before you rely on it.
> Every package is at 1.0 or later on full semver; depend on the caret range
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

What the project does to keep releases trustworthy. The
[security assurance case](./docs/assurance-case.md) justifies _why_ these
measures meet the project's security requirements — the threat model, the trust
boundaries, and the design-principle arguments behind the list below:

- **Zero runtime dependencies.** Every published package declares no dependency
  but `@zuke/core`, so nothing third-party is shipped to consumers. The build
  layer is separate and does have them: `@std/yaml` for `build/`, `cspell` and
  `release-please` installed from npm on demand, and four checksum-verified
  binaries (the Codecov CLI, zizmor, actionlint, gitleaks) provisioned by the
  build's `toolchain()`. All of it is dev/release-time only.
- **Injection-free command execution.** All process execution goes through
  `Deno.Command` on Deno and `node:child_process` on Node, with a discrete argv
  array — there is no shell string, so interpolated values can never be
  reinterpreted as shell syntax.
- **Trusted publishing via OIDC.** Packages publish to JSR with a short-lived
  OIDC token (`id-token: write`); no long-lived JSR token exists. The npm
  release, as `@zuke-build/<name>`, authenticates with an `NPM_TOKEN` secret
  that only the `publishNpm` job's `npm` environment holds, and signs each
  version's provenance with the job's OIDC identity. JSR and npm record build
  **provenance** for each published version.
- **Least-privilege CI.** The default workflow token is `contents: read`. The
  release pipeline is split so the `release` job (`contents` / `pull-requests:
  write`) and the `publishJsr` job (`id-token: write`) never hold each other's
  privileges.
- **Pinned, monitored Actions.** Every GitHub Action is pinned to a full commit
  SHA, with a version comment kept current by Dependabot. Every job that holds a
  write-scoped token runs `step-security/harden-runner` with an `egress-policy:
  block` allowlist, so outbound access is enforced rather than merely audited.
  The `test` job in `ci.yml` is the exception: it holds no token and only runs
  the test suite.
- **Pinned toolchain.** The `./zuke` launcher bootstraps a **pinned** Node (or,
  for a Deno project, Deno) version, so CI and local builds install a known
  version rather than a moving `latest`. Dependencies are resolved against a
  committed `package-lock.json` (installed with `npm ci`) on Node, or
  `deno.lock` enforced with `--frozen` on Deno. The scanner CLIs are pinned and
  checksum-verified in `build/scanners.ts` and provisioned by the build itself,
  so the security workflow needs no install step and nothing has to be present
  on `PATH`.
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

- **Bootstrap launchers.** `./zuke` and `./zuke.ps1` install the project's
  runtime (Node, or Deno for a Deno project) on first use by downloading the
  pinned release archive from GitHub and verifying it against a per-platform
  SHA-256 baked into the launcher. No install script is fetched or executed. On
  Deno, `DENO_VERSION=latest` is **refused** — a moving target has no checksum
  to pin — and overriding the version requires supplying a matching
  `DENO_SHA256`, so the launcher never runs an unverified binary. To skip the
  bootstrap entirely, install the runtime yourself so the launcher finds it on
  `PATH`.
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
- **The comment-started AI review runs with secrets on any pull request.** The
  `commandReview` job in `ai-review.yml` runs on `issue_comment` when a human
  account with push access comments `@zuke-build review` or `@zuke-build accept
  …` on a pull request — a fork's included, which the `pull_request` job must
  skip. It holds `OPENAI_API_KEY` and the `zuke-build` App's credentials, and it
  is safe for a fork because **the pull request's code never runs there**: the
  job checks out `master`, and the reviewers fetch the pull request's merge ref
  as data and diff it. The App's credentials are used only to mint a token
  narrowed to `pull_requests`, `issues` and `contents` write, so the review
  posts as `zuke-build[bot]` and can resolve the review threads it answers —
  GitHub allows that mutation only to repository write access, which for an
  installation token is `contents: write`; nothing touching workflows or Actions
  is minted. The `pull_request` job holds the same credentials, so a
  push-started review can close its threads too; that job executes the pull
  request's own build, which is acceptable because only maintainers can push a
  branch and every repository secret is already readable from one, a fork's run
  receives no secrets from GitHub, and the job blocks egress to the launcher's
  endpoints, GitHub and the model provider. The maintainer's comment is the
  command's human gate, and the gate is the job's `if:`, every clause of which
  reads metadata GitHub asserts. The event's `author_association` is not among
  them: GitHub reports a private organisation member as `CONTRIBUTOR`, and
  `MEMBER` and `COLLABORATOR` admit read-only accounts, so the job's first step
  asks the collaborators API for the commenter's permission and skips the review
  unless it is `admin` or `write`, before any key is spent.

## Verifying a release

Every published `@zuke/*` version can be verified against this repository. Each
check below says what it proves and what it does not; none of them proves the
source itself is free of bugs.

### Verify what you install

**JSR.**

- **Provenance (signature).** Packages are published to JSR via OIDC trusted
  publishing, and JSR records a [Sigstore](https://www.sigstore.dev/) provenance
  attestation for each version, signed by the release workflow's short-lived
  OIDC identity, so there is no long-lived private key anywhere, let alone on
  the distribution site. Open the version on [jsr.io](https://jsr.io/@zuke/core)
  and check its **provenance** panel: it names this repository, the exact
  commit, and the workflow run that published it. A version without provenance,
  or with provenance naming another repository or a commit that is not on
  `master`, should be treated as compromised and reported (see above). _Proves_
  which workflow and commit published it. _Does not prove_ anything about that
  commit's content.
- **Source equality.** The published artifacts are the committed source files
  (there is no build/compile step), so a version's contents can be diffed
  directly against its provenance-named commit. _Proves_ the files are the
  commit's. _Does not prove_ the commit is sound.

**npm** (`@zuke-build/<name>`, compiled from the same sources).

- **Provenance badge.** the npm website shows a "Built and signed on GitHub
  Actions" badge on a version published with provenance, linking the commit and
  the workflow run. _Proves_ which workflow and commit built it. _Does not
  prove_ the files are what that commit compiles to, only that the workflow
  produced them.
- **`npm audit signatures`.** In your own project, after installing, run `npm
  audit signatures`: it checks the registry's signature of every installed
  package, and the provenance attestation of those that have one. _Proves_ the
  tarball carries npm's registry signature, and that some Sigstore identity
  signed its provenance; it applies no policy to which identity, so it does not
  prove the identity is ours (`npmVerify`, below, checks that). _Does not prove_
  what the tarball contains; a package without an attestation is reported, not
  failed.
- **Rebuild it.** From any clone with full history (`git clone`, then `./zuke
  npmVerify`; no tag needs checking out) run `./zuke npmVerify`. For each
  published version it reads the commit X named by that version's own signed
  provenance, requires X to be on `master`, and rebuilds the package from X: a
  git worktree at X, built by X's own build scripts and pinned compiler (not
  this checkout's), once per distinct X. It installs the published versions from
  the registry with `npm install --ignore-scripts` (so what is compared is what
  npm unpacks, not what a tar reader of ours sees), and compares every installed
  file with the rebuild byte for byte; `package.json` is compared as parsed
  JSON, since a newer npm may re-serialise it. npm acts on the registry's
  metadata for a version, not on the tarball's `package.json`, so it also
  compares that metadata's scripts, dependencies, bin, os and the other fields
  npm acts on with the rebuild, and checks that npm's lockfile holds only our
  packages, none with an install script or a bin. The `@zuke/<name>` aliases the
  packages import each other through are pinned to the versions verified in the
  same run, recorded in the lockfile with the same integrity, and their files
  compared too; a package whose dependency was not verified there is reported,
  not verified. For each version it requires an npm SLSA provenance attestation
  and checks, with sigstore-js itself, that the Sigstore bundle verifies and
  that its certificate was issued to the GitHub Actions identity
  `https://github.com/zuke-build/zuke/.github/workflows/release.yml@refs/heads/master`
  for repository `zuke-build/zuke`, ref `refs/heads/master` and a commit equal
  to the one the signed statement names, which is X; that the statement names a
  subject sha512 equal to the registry's integrity; and that npm's lockfile
  records that integrity for what it installed. Only then is X trusted and
  rebuilt. Finally `npm audit signatures` checks the registry's own signatures
  of everything installed. _Proves_ the package was built by `release.yml` of
  `zuke-build/zuke` on `master` from commit X, and that the bytes npm serves are
  exactly what that master commit compiles to. A version that is not on npm
  (after retries of up to ten minutes, for the registry to catch up with a
  publish), or one without provenance, fails. Only `--allow-none`, for a
  checkout whose versions were never published, reports a missing version and
  skips it. _Does not prove_ the source is free of bugs, nor that X's source is
  the source of the version's release tag or of its JSR package (see the
  disclosure below). It trusts Sigstore's trusted root (fetched over TUF) and
  the registry's document, which the signed statement and the lockfile are
  checked against.
- **Disclosure: the first npm publish.** The initial bulk publish of all 70
  packages to npm, on 2026-11-20, built every package from one commit,
  `09d0edc`. For a package whose sources changed after its release, that npm
  version contains the newer source rather than the JSR files of the same
  version. The provenance says so, and `npmVerify` proves it. From then on,
  `publishNpm` publishes a version only when `packages/<name>` is unchanged
  since its release tag `<name>-v<version>` (and the tag exists), so a later npm
  version is the same source as its JSR version. JSR is unaffected. The same run
  also left a `0.0.0-stage` version on every package: npm's own placeholder for
  staged publishing, created when a package is first published. It is a two-file
  stub with no code, no scripts and no provenance, is never `latest`, and no
  `^1` range resolves to it; `npmVerify` does not check it.
- **The public job.** The release workflow's **Verify npm packages** job runs
  `./zuke npmVerify` after every publish, on Ubuntu, macOS and Windows, with a
  read-only token and no secrets. Its log is public. _Proves_ the same rebuild
  agrees on three operating systems. _Does not prove_ more than running it
  yourself does; it is the same code.

**CLI binaries.** Each release archive carries a build-provenance attestation,
and the release lists the SHA-256 of every archive; `gh attestation verify`
checks one against this repository and the release workflow. The launchers and
the Homebrew and Chocolatey packages pin the same SHA-256 and check it on every
download. [Installing](./docs/install.md#verifying-a-download) has the commands.
_Proves_ the archive was built by this repository's release workflow and is the
one the release lists. _Does not prove_ the source is sound.

- **Launcher downloads.** The `./zuke` / `zuke.ps1` launchers verify the Node or
  Deno archive they bootstrap against a per-platform SHA-256 baked into the
  launcher, as described under "Known trade-offs".

Git tags are created by release-please through the GitHub API and are **not**
GPG-signed; the provenance attestation above is the release signature to rely
on.

## Running the scanners yourself

The same scanners are exposed as Zuke tasks via
[`@zuke/security`](./packages/security), so any consumer can run them in their
own pipeline:

```ts
import { SecurityTasks } from "@zuke/security";

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
- **Require 2FA** for all maintainers, on GitHub, JSR and npm.
- **Scope the JSR ↔ repo OIDC link** so publishing is allowed only from this
  repository's release workflow.
