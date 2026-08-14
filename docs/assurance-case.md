# Security assurance case

Why Zuke's security requirements are met: the threat model, the trust
boundaries, and the argument that secure design principles are applied and
common implementation weaknesses countered. [`SECURITY.md`](../SECURITY.md)
states the policy (how to report, how releases are verified); this document
justifies it. Both are maintained together — a change that moves a trust
boundary updates this file in the same pull request.

## Security requirements

Zuke is a build-automation framework: it runs inside other projects' CI
pipelines with their credentials in scope, and it publishes 50+ packages to a
public registry. From that, its security requirements are:

1. **What consumers install is what this repository contains.** No tampering
   between the merged source and the published package (supply-chain integrity).
2. **Zuke must not become an injection vector.** Values a build interpolates
   into commands — parameters, environment values, file contents — must never be
   reinterpreted as shell syntax or extra arguments.
3. **The project's own pipeline must contain a compromise.** A malicious pull
   request, a compromised third-party action, or a leaked token must be limited
   in what it can read, write, or exfiltrate.
4. **Secrets must not leak** — not into the repository history, not into logs,
   not to unintended network destinations.

## Threat model

Adversaries considered, and the assets they target:

| Adversary                            | Target                          | Primary counter                                                                                                                                     |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious contributor (fork PR)      | CI secrets, write token         | Fork PRs run with a read-only token and no secrets; `pull_request` (never `pull_request_target`) triggers                                           |
| Compromised third-party action       | CI secrets, published artifacts | Every action pinned to a full commit SHA; Dependabot bumps pins; zizmor audits workflows                                                            |
| Compromised build-time dependency    | Release credentials, egress     | `--frozen` lockfile; zero runtime dependencies; egress **blocked** to an allowlist on every job holding a write-scoped token                        |
| Registry-level attacker              | Consumers of `@zuke/*`          | OIDC trusted publishing; Sigstore provenance per version; no long-lived registry tokens exist                                                       |
| Network attacker (MITM) on bootstrap | Developer/CI machines           | Launcher downloads the pinned Deno release over HTTPS and verifies a per-platform SHA-256 baked into the launcher; `DENO_VERSION=latest` is refused |
| Careless or compromised insider      | Repository history              | gitleaks scans full history on schedule and pushes; PR-scoped scans on every pull request; secret parameters are redacted from output               |

Out of scope: vulnerabilities in GitHub, JSR, or Deno themselves (they are the
trusted computing base — see the boundaries below), and denial of service
against public CI.

## Trust boundaries

1. **Pull request → gate.** Code in a PR is untrusted until the required CI gate
   and review pass. Fork PRs cross this boundary with a read-only token and no
   secrets. The PR _body_ is also untrusted: it reaches the build only through
   an environment variable, never interpolated into a shell line.
2. **Build layer → published packages.** The build layer (`build/`, `zuke.ts`)
   may use dev dependencies; the published packages under `packages/` may not
   depend on anything third-party. The boundary is enforced by each package's
   `deno.json` declaring no dependencies, so nothing the build layer trusts is
   shipped to consumers.
3. **CI jobs → each other.** Job token scopes are disjoint by design: the
   release job (repo write) never holds the JSR OIDC credential, and the publish
   job (OIDC) never holds a write-scoped repo token. A compromise of one job
   does not yield the other's authority.
4. **CI jobs → network.** Every job that holds a write-scoped token runs with
   egress _blocked_ to a named allowlist, so even code that reads a token has
   nowhere unauthorized to send it.
5. **Repository → third-party code.** Actions cross the boundary only at pinned
   commit SHAs; scanner binaries only with verified checksums
   (`build/scanners.ts`); modules only through the committed, frozen
   `deno.lock`.
6. **Trusted computing base.** GitHub (repository, Actions, OIDC issuer), JSR
   (registry, provenance), and the pinned Deno runtime are trusted. Attacks on
   them are acknowledged as out of scope above.

## Secure design principles

- **Least privilege.** The default workflow token is `contents: read`; each job
  opts into exactly the scopes it needs (see boundary 3). The one deliberate
  elevation — the lint fixer's `contents: write` on the `ci` job — is documented
  as a trade-off in `SECURITY.md`, and is inert for fork PRs.
- **Fail-safe defaults.** The lockfile is enforced with `--frozen`, so a missing
  resolution fails the run instead of being healed silently. The launcher
  refuses a Deno version it cannot verify against a pinned checksum. The
  coverage gate fails the build below threshold rather than warning.
- **Complete mediation.** One gate (`./zuke ci`) stands in front of every merge
  — the same gate locally and in CI, so there is no unchecked path to `master`;
  releases are cut only from `master`.
- **Economy of mechanism.** Zero runtime dependencies and a single toolchain
  (Deno) keep the attack surface enumerable: what ships is only this
  repository's source.
- **Open design.** The build, the workflows (generated from
  `build/workflows.ts`), the scanners, and this assurance case are all public;
  nothing relies on secrecy.
- **Separation of privilege.** Publishing requires the release pipeline's OIDC
  identity — a stolen personal token cannot produce a provenance-valid release,
  and provenance names the workflow and commit for anyone to check.

## Common implementation weaknesses countered

- **Command injection** (the classic build-tool weakness): the `$` shell
  tokenises interpolated values into discrete argv entries and all process
  execution goes through `Deno.Command` — there is no shell-string concatenation
  anywhere to inject into.
- **Type confusion / unsafe casts:** strict TypeScript with `any`, forced `as`
  casts, and non-null `!` assertions banned by policy and lint; runtime guards
  are exercised by tests.
- **A guard hardened in one copy and not the other:** a security check whose
  value is being applied everywhere must have exactly one implementation, so
  fixing it fixes every call site. Duplicated logic is a review-blocking defect
  rather than a style note, because copies drift: a second zip-slip guard, a
  Markdown escaper missing a sibling's newline collapse, two loopback checks
  disagreeing about `[::1]`, and a `JSON.parse` guard present in one of two twin
  stores were all found and consolidated this way. Policy in
  [`AGENTS.md`](../AGENTS.md#coding-guidelines-non-negotiable); both AI
  reviewers read it from the diff base and flag retyped helpers.
- **Regression and logic errors:** a 95% line-and-branch coverage gate, three
  test layers (unit, in-process integration, cross-process e2e on three OSes),
  and an adversarial review pass on every feature.
- **Vulnerable patterns in new code:** CodeQL's security suite analyzes every
  pull request and push (including the `actions` pack over the workflow YAML);
  zizmor and actionlint audit the workflows in the required gate.
- **Secret leakage:** gitleaks in the gate and on schedule; secret parameters
  are redacted from build output; no credentials are persisted into
  `.git/config` in release jobs.
- **Dependency confusion / typosquatting:** consumers install from the `@zuke`
  JSR scope with per-version provenance; the npm-side `@zuke-build` org is
  reserved to prevent squatting.

## Residual risks

The known, accepted trade-offs — the dirty-tree publish backstop, the lint
fixer's write scope, and the bootstrap-download design — are documented with
their mitigations in
[`SECURITY.md` § Known trade-offs](../SECURITY.md#known-trade-offs). The
project's largest non-technical risk, a bus factor of one, is tracked in
[`GOVERNANCE.md`](../GOVERNANCE.md) and [`ROADMAP.md`](../ROADMAP.md).
