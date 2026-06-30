<!--
Thanks for contributing to Zuke! A few things that make review fast:

The PR title IS the release trigger. This repo squash-merges, and
release-please parses only the squashed subject (your PR title). Title this PR
as a Conventional Commit so the right version is cut:

  feat(deno): add coverage threshold flag     -> minor bump
  fix(core): resolve forward-reference order   -> patch bump
  docs|chore|refactor|test(...): ...           -> no release

The scope is cosmetic; the bump is attributed to whichever package's files
under packages/<name>/ this PR changes.
-->

## What & why

<!-- What does this change do, and what problem does it solve? Explain the
motivation, not just the mechanics. -->

## Related issues

<!-- e.g. "Closes #123". Link any issue this addresses. -->

## Checklist

- [ ] The PR title is a [Conventional Commit](https://www.conventionalcommits.org/) (`type(scope): summary`).
- [ ] `deno task ci` passes locally (lint, fmt, type-check, tests, spell).
- [ ] Tests were added or updated; coverage stays at 95%+ (lines and branches).
- [ ] Docs updated in the same PR (`README.md`, JSDoc, `docs/`) when behaviour changed.
- [ ] Public API changes were regenerated with `./zuke apiDocs` (`llms.txt`, `llms-full.txt`, package README `## API`).
- [ ] No `any`, no `as` casts or `!` non-null assertions in `src/` (narrow with type guards instead).
- [ ] A new package was wired into all five places (see [CONTRIBUTING](../blob/master/CONTRIBUTING.md)), if applicable.
- [ ] The code is written using AI assisted coding.

<!-- Keep illustrative code in this description, not in commit message bodies:
release-please's strict parser can drop a commit whose body contains code with
parentheses, silently skipping it from the release. -->
