# Security review

The security reviews this project has performed: their scope, method,
findings, and outcomes. Each review considers the security requirements and
the trust boundaries defined in the
[assurance case](./assurance-case.md) — the requirements say what must hold;
a review checks that the implementation actually holds it.

## 2026 review — MCP authorization and audit surface

**When:** 2026 (pre-release adversarial pass). **Who:** the project lead, with
independent AI adversarial reviewers attacking each dimension; every candidate
finding was verified against the real code path before being accepted.

**Scope:** the MCP server's authorization and audit surface — the boundary
where an external AI agent is allowed to inspect and (optionally) execute
build targets — reviewed against the requirements that authorization is
enforced on every path and that secrets never reach output.

**Method:** adversarial review as described in
[`AGENTS.md`](../AGENTS.md#adversarial-review-every-feature): independent
reviewers attempted bypasses, leaks, race conditions, unhandled throws, and
untested security branches; findings were reproduced against the code
(defaulting to refuted when a reproduction failed).

**Confirmed findings, all fixed before the change shipped, each with a
regression test:**

1. An **authorization bypass** — a path that reached target execution without
   passing the authorization check.
2. A **secret-redaction gap** — a route by which a secret value could reach
   output without being redacted.
3. A **transport-crashing throw** — an unhandled error that could take down
   the MCP transport, a denial-of-service defect.

All three had passed lint, strict type-checking, and the 95% coverage gate —
which is why the project treats adversarial review as a standing requirement
for every feature, not a one-time event.

## 2026 review — supply-chain posture and workflow surface

**When:** August 2026. **Who:** the project lead with AI-assisted review.

**Scope:** the CI/CD and release surface against the supply-chain security
requirements: workflow token scopes, egress policy, action pinning, publish
credentials, and the bootstrap path.

**Outcome:** the posture documented in [`SECURITY.md`](../SECURITY.md) and
justified in the [assurance case](./assurance-case.md) — least-privilege
per-job tokens, blocked egress on write-scoped jobs, SHA-pinned actions,
OIDC-only publishing with Sigstore provenance — plus the CodeQL workflow
(security queries over the sources and the `actions` pack over the workflow
YAML) added as a standing static-analysis lane, and the OpenSSF Scorecard
run publishing its findings to code scanning. Documentation that had drifted
from the implemented posture (the CodeQL setup guidance) was corrected as a
finding of this review.

## Standing review, between the point-in-time ones

Every pull request receives an AI security assessment posted to the thread,
CodeQL analysis, and the scanner gate (zizmor, actionlint, gitleaks); every
feature receives the adversarial pass. The next dedicated review is due when
a trust boundary moves — a new transport, a new credential, a new privilege —
as the assurance case requires that document and this one move in the same
pull request.
