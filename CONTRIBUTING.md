# Contributing to Zuke

Thanks for your interest in improving Zuke! This project is a code-first,
strongly-typed build automation system for Deno & TypeScript, and contributions
of all kinds — bug reports, docs, tests, and code — are welcome.

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

> [!NOTE]
> Every Zuke package is `1.x` on full semver — see
> [Versioning & compatibility](./docs/versioning.md) for the compatibility
> promise, the `@zuke/core` floor, and pinning guidance. If you are planning a
> large change, please open an issue first so we can agree on the direction
> before you invest the effort.

## Prerequisites

- [Deno](https://deno.com/) 2.x — the only toolchain you need. There is no Node,
  npm, or external build step. The test runner, formatter, linter, type-checker,
  and coverage tooling are all the built-in `deno` CLI.

## Getting started

```sh
git clone https://github.com/zuke-build/zuke.git
cd zuke
deno task ci   # run the full gate to confirm a clean baseline
```

## Development workflow

| Task                          | Command                                 |
| ----------------------------- | --------------------------------------- |
| Run tests                     | `deno task test`                        |
| Coverage + gate (95%)         | `deno task cov`                         |
| Human-readable coverage table | `deno task cov:report`                  |
| Type-check everything         | `deno task check`                       |
| Format / check formatting     | `deno task fmt` / `deno task fmt:check` |
| Lint                          | `deno task lint`                        |
| Spell-check                   | `deno task spell`                       |
| Full pre-commit / CI gate     | `deno task ci` / `./zuke ci`            |

**Run `deno task ci` before opening a pull request — it must be green.**
`deno task ci` is `deno run -A --frozen zuke.ts ci`, the same gate CI's `ci` job
runs (see [`AGENTS.md`](./AGENTS.md#commands) for the full check list) — so a
green `deno task ci` locally means a green CI run. If you change a public API,
regenerate the docs in the same change (`./zuke apiDocs`) — `ci` includes
`apiDocsCheck`, which fails on stale generated docs.

## Coding standards (non-negotiable)

These mirror [`AGENTS.md`](./AGENTS.md), which is the source of truth for how
code in this repo is written (`CLAUDE.md` is a one-line pointer to it):

1. **Strict, strongly-typed TypeScript.** Never use `any` (the `no-explicit-any`
   lint rule is on). Never use `as` to force a type or the non-null assertion
   `!` to silence the compiler — narrow with control flow and type guards
   instead. The single sanctioned escape is a `// @ts-expect-error` in a test
   that deliberately exercises a runtime guard against type-unsafe input, with a
   comment explaining why. Do not use it in `src/`.
2. **Everything must pass.** Linting, formatting, type-checking, and tests are
   all enforced by `deno task ci`.
3. **Keep coverage at 95%+** (lines and branches) at all times. New code needs
   new tests in the same change.
4. **Document the public API.** Every exported symbol carries a JSDoc comment;
   match the existing density and tone.
5. **Tests are hermetic and fast.** No network and no reliance on ambient tools.
   When a test needs a subprocess, invoke `Deno.execPath()` (the running
   `deno`), which is always present and shell-free.

See the architecture notes in [`AGENTS.md`](./AGENTS.md#architecture-notes) for
how targets, the dependency graph, the shell `$`, and tool wrappers fit
together.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) and the
repository squash-merges pull requests, so the PR title and description become
the squash commit that [release-please](./RELEASING.md) parses.

- Use the imperative mood and explain the _why_, not just the _what_.
- Keep commit bodies to prose. **Do not put code snippets in commit message
  bodies** — release-please uses a strict parser, and a code fragment with
  parentheses can make it silently drop the whole commit from the release. Put
  illustrative code in the PR discussion instead.
- Keep changes small and focused so they stay reviewable.

## Pull requests

1. Fork and create a topic branch from `master`.
2. Make your change, adding tests and docs in the same PR.
3. Run `deno task ci` and make sure it is green.
4. Open a pull request with a clear description of the change and its
   motivation. Link any related issue.
5. Update `README.md`, JSDoc, and the relevant docs in `docs/` whenever
   behaviour changes.

## Code review

Every change reaches `master` through a pull request — there is no direct
push path — and review has documented requirements:

**How review is conducted.** Each PR is reviewed by (1) the required CI gate
(`deno task ci`, the same gate you run locally), (2) the AI reviewers, which
post a security assessment and a code-quality assessment as PR comments, and
(3) a human maintainer, who reads the diff and every reviewer finding. AI
findings are advisory: a maintainer addresses each one or answers it on the
thread, quoting the finding's id — they never merge unexamined.

**What must be checked.** Reviewers verify that the change:

- is correct, and covered by tests per the testing policy above (unit +
  integration in the same PR; e2e for cross-process or cross-OS behaviour);
- introduces no security regression (injection, privilege escalation, secret
  exposure — see the
  [assurance case](./docs/assurance-case.md) for the boundaries to respect);
- meets the coding standards above (strict types, no `any`/`as`/`!`, JSDoc on
  all public symbols) and keeps coverage at 95%+;
- updates the affected docs in the same PR, and regenerates the API docs on
  any public-API change;
- carries a Conventional Commit PR title, since the squash subject is what
  release-please parses.

**What is required to be acceptable.** A PR merges only when the required
status checks are green, every AI-reviewer finding has been fixed or answered,
and a maintainer approves. Larger features additionally get an adversarial
review pass before the PR is finalized (see
[`AGENTS.md`](./AGENTS.md#adversarial-review-every-feature)).

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/zuke-build/zuke/issues) first.
- For bugs, include a minimal reproduction, the Deno version, and what you
  expected versus what happened.
- For ideas and open-ended questions, open an
  [issue](https://github.com/zuke-build/zuke/issues) with the relevant label.

## Security

Please **do not** open public issues for security vulnerabilities. Follow the
private reporting process in [`SECURITY.md`](./SECURITY.md) instead.

## Developer Certificate of Origin

Contributions are accepted under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/) (DCO).
By opening a pull request you certify that you wrote the contribution (or
otherwise have the right to submit it) and that you may license it under this
project's [MIT License](./LICENSE). A `Signed-off-by:` trailer (`git commit -s`)
is welcome as an explicit record, but submitting the pull request itself
constitutes your certification.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](./LICENSE).
