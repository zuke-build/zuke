# Governance

How decisions are made in Zuke, and who makes them. This document exists so that
contributors know who to ask, what to expect, and how authority is transferred —
not to add ceremony to a small project.

## Model

Zuke uses a **lead-maintainer model** (often called BDFL): a single project lead
holds final decision authority, exercised only when ordinary discussion does not
converge. Day-to-day, decisions are made in the open — in issues and pull
requests — and the vast majority resolve by consensus there.

## Roles

### Project lead

**Todor Todorov** ([@totollygeek](https://github.com/totollygeek)) is the
project lead and currently the sole maintainer.

The lead is responsible for:

- Final say on design, scope, and releases when discussion does not converge.
- Merging pull requests and cutting releases (releases are automated by
  release-please; the lead approves and merges the release PRs).
- The security response process described in [`SECURITY.md`](./SECURITY.md):
  triaging private vulnerability reports, coordinating fixes and disclosure, and
  publishing advisories.
- Administering the GitHub organization, the JSR scope, and the
  [Code of Conduct](./CODE_OF_CONDUCT.md) enforcement contact
  (**contact@zuke.build**).

### Maintainers

Maintainers share the lead's merge and triage duties. A contributor becomes a
maintainer by sustained, high-quality contributions and an invitation from the
project lead. Maintainers are listed in [`CODEOWNERS`](./.github/CODEOWNERS);
today that list is the project lead.

Growing this group is an explicit goal (see [`ROADMAP.md`](./ROADMAP.md)): a bus
factor of one is the project's biggest continuity risk, and the roadmap tracks
fixing it.

### Contributors

Anyone who opens an issue or pull request. Contributions are governed by
[`CONTRIBUTING.md`](./CONTRIBUTING.md) — including the coding standards, the
required CI gate, and the Developer Certificate of Origin — and by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

### Automated reviewers

The repository runs AI reviewers (`@zuke/ai`) that post assessments on every
pull request. Their findings are **advisory**: maintainers read and answer them,
but they hold no authority — a human decides what merges.

## Decision making

1. Changes are proposed as issues or pull requests and discussed in public.
2. Consensus among maintainers (and interested contributors) decides most
   things.
3. When consensus does not emerge, the project lead decides.
4. Large or breaking changes should start as an issue before code is written, as
   [`CONTRIBUTING.md`](./CONTRIBUTING.md) asks.

## Continuity

If the project lead becomes unavailable for an extended period, the remaining
maintainers (or, while there are none, the GitHub organization's owners) assume
the lead's responsibilities and appoint a successor. Repository and registry
access are held by the `zuke-build` GitHub organization and the `@zuke` JSR
scope rather than a personal account, so control transfers with organization
membership.

## Changing this document

Governance changes are proposed as pull requests to this file and decided by the
project lead.
