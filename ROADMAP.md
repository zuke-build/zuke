# Roadmap

What Zuke intends to do — and not do — over the next year. This is a living
document: it is revisited at least yearly and adjusted as the project learns.
Dates are deliberately absent; items ship when they meet the bar in
[`AGENTS.md`](./AGENTS.md), not when a calendar says so.

Last reviewed: **2026-08**.

## Near term

- **Harden the release pipeline further.** Drop `deno publish --allow-dirty`
  once a production release confirms the merged release tree is clean, giving
  the strongest "published == committed source" guarantee. Tracked as a known
  trade-off in [`SECURITY.md`](./SECURITY.md).
- **OpenSSF Best Practices badge: silver, then gold.** Passing is attained; the
  remaining silver items are documented governance (done with this roadmap's
  PR), reporter credit, and a documented release-verification process. Gold
  requires — among other things — a second maintainer, which is also the
  project's bus-factor fix.
- **Grow the maintainer group beyond one.** Actively invite sustained
  contributors into maintainership (see [`GOVERNANCE.md`](./GOVERNANCE.md)).
  This is the single most important continuity item on this list.

## Medium term

- **Expand the tool wrapper catalogue.** Keep adding typed `@zuke/<tool>`
  wrappers where real builds need them, at the existing quality bar (settings
  lambdas mirroring the real CLI, pure `buildArgs()`, wrapper conformance
  tests). Quality over count: a wrapper ships when it covers its tool's everyday
  surface, not before.
- **npm distribution.** The `@zuke-build` npm organization is reserved for a 1:1
  mapping of the JSR packages. Publishing begins once the Node/npm consumption
  story (module resolution, launcher behaviour outside Deno) is designed and
  tested — not before.
- **TypeScript 7 / native type-checking.** Adopt `deno check`'s native (`tsgo`)
  compiler for the repository's own gate as soon as Deno declares it stable.
  Until then the default checker stays authoritative; the unstable flag is not
  allowed into CI. Status is tracked in
  [`AGENTS.md`](./AGENTS.md#typescript-7--tsgo).

## Explicit non-goals

- **No runtime dependencies.** The published packages stay dependency-free
  (`@zuke/core` as the only internal exception). Features that would require
  shipping a third-party runtime dependency are rejected or redesigned.
- **No second toolchain.** Deno remains the only required tool. No Node, npm, or
  external build system is needed to develop or use Zuke, even after npm
  distribution exists for consumers.
- **No weakening of the gate.** The 95% coverage threshold, the frozen lockfile,
  pinned actions, and the adversarial-review practice are floors, not
  aspirations; roadmap work does not trade them away for speed.

## How to influence this

Open an issue — roadmap discussion happens in public, like every other decision
(see [`GOVERNANCE.md`](./GOVERNANCE.md)). Items move onto this list when a
maintainer commits to them, and off it when they ship or are explicitly dropped
with a note here.
