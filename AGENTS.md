# AGENTS.md

Guidance for working in this repository. Read this before making changes.

Zuke is a code-first, strongly-typed build automation system for
Deno/TypeScript.

> This file, `AGENTS.md`, is the single source of truth for both humans and
> agents. `CLAUDE.md` is a thin pointer whose entire content is `@AGENTS.md`, so
> Claude Code loads this file and there is exactly one copy to maintain.

## Using Zuke — the API, without guessing

If you are wiring Zuke into a project, **do not guess the API and do not fall
back to `Deno.Command`/shell.** Every operation has a typed wrapper, and the
exact signatures are published — read them:

- **One file with the whole typed surface of every package:**
  [`llms-full.txt`](./llms-full.txt) at the repo root. [`llms.txt`](./llms.txt)
  is the short index.
- **A single wrapper on the command line:** `deno doc jsr:@zuke/<package>`
  (e.g. `deno doc jsr:@zuke/deno`).
- **On each package's JSR page / README:** a generated `## API` section.
- **The CLI surface — commands, flags, and a build's actual targets:** run
  `zuke --help` (or `deno run -A zuke.ts --help`). It prints the usage grammar,
  every reserved command (`graph`, `generate-ci`,
  `completions <print|install> <shell>`) and flag, **plus the current build's
  targets — with descriptions and dependencies — and its parameters.** So an
  agent asked to set up or run a build discovers the real command surface live
  instead of guessing; `zuke --list` is the targets-only view and
  `zuke --list --json` emits the whole surface (commands, flags, targets,
  parameters) as JSON for tools. The written reference is
  [`docs/cli.md`](./docs/cli.md), and [`llms.txt`](./llms.txt) carries a
  generated `## CLI` section; the same data is available in code via the
  exported `describeCli(build)`.

The mental model:

- A build is a class that **extends `Build`**. Each **target is a class field**
  built with `target()`: `.description(...)`, `.dependsOn(...)`,
  `.executes(async () => { … })`.
- **Dependencies are `this.<field>` references, not strings** — `dependsOn(this.lint)`,
  never `dependsOn("lint")` — so renames and typos are compile-time errors. A
  target may only depend on siblings **declared above it** (fields initialise
  top-to-bottom).
- Make the file runnable with **`await run(MyBuild)`** at the bottom — no
  `if (import.meta.main)` guard; `run` no-ops when the module is imported.
- **Every external tool is a namespaced `*Tasks` object** (`DenoTasks`,
  `NpmTasks`, `DockerTasks`, `GitTasks`, …) configured with a **settings
  lambda** that mirrors the real CLI's flags:

  ```ts
  import { Build, run, target } from "jsr:@zuke/core";
  import { DenoTasks } from "jsr:@zuke/deno";

  class CI extends Build {
    lint = target().executes(() => DenoTasks.lint());
    test = target().dependsOn(this.lint)
      .executes(() => DenoTasks.test((s) => s.allowAll().coverage("cov_profile")));
  }

  await run(CI);
  ```

These three artifacts (`llms.txt`, `llms-full.txt`, and every package's README
`## API` block) are **generated** from `deno doc` by `./zuke apiDocs`, and CI
fails (`./zuke apiDocsCheck`) if they drift — so any change to a public API must
regenerate them in the same PR.

## Tech stack

- **Runtime & toolchain:** [Deno](https://deno.com/) (2.x). All tooling — test
  runner, formatter, linter, type-checker, coverage — is the built-in `deno`
  CLI. No Node, npm, or external build tools.
- **Language:** TypeScript, strict mode (Deno's default).
- **Distribution:** [JSR](https://jsr.io/) as a workspace of four packages:
  `@zuke/core` (exports `.`, `./shell`, `./tooling`), `@zuke/deno`, `@zuke/npm`,
  `@zuke/cmd`. The npm org `@zuke-build` is reserved for future npm distribution
  (1:1 name mapping).
- **No runtime dependencies.** The library is dependency-free; tests use a local
  assertion helper (`tests/_assert.ts`) rather than a third-party assert library
  so the suite runs with zero network access.

### TypeScript 7 / `tsgo`

The request is to use `tsgo` (the native TypeScript port, a.k.a. TypeScript 7)
**if Deno supports it.** As of the current toolchain it does **not**: Deno
type-checks with its own embedded TypeScript via `deno check` and provides no
hook to delegate checking to an external `tsc`/`tsgo` binary. `tsgo`
(`@typescript/native-preview`) is a standalone preview that also does not
understand Deno's module resolution (`jsr:`/`https:` specifiers, the `Deno`
global) out of the box.

**Therefore:** `deno check` is the authoritative type-checker for this repo.
Adopt `tsgo`/TS7 only once Deno can use it as its checker — at that point,
update the `check` task and CI accordingly. Do not bolt on a parallel
`tsc`/`tsgo` pass that can't see Deno's module graph.

## Coding guidelines (non-negotiable)

1. **Strict, strongly-typed TypeScript.**
   - Never use `any`. The `no-explicit-any` lint rule is enabled.
   - Never use `as` to force a type or silence the compiler, and avoid the
     non-null assertion `!`. Narrow with control flow and type guards instead
     (e.g. `value instanceof Error ? value.message : String(value)`).
   - The single sanctioned escape is a `// @ts-expect-error` **in a test** that
     deliberately exercises a runtime guard against type-unsafe input, with a
     comment explaining why. Do not use it in `src/`.
2. **All linting, formatting, type-checking, and tests must always pass.** Run
   `deno task ci` before committing; it must be green.
3. **Keep test coverage at 95%+ (lines and branches) at all times.** Enforced by
   the coverage gate built into `DenoTasks.coverage` (a `.threshold()` parses
   the lcov report and fails the build), wired up in the `cov` task /
   `zuke coverage` target and in CI. New code needs new tests in the same
   change.
4. **Document every public symbol — JSDoc on ALL of it.** A JSDoc comment is
   required on every exported symbol **and on every public member of an exported
   class or interface**: methods, fields (including the trailing-underscore
   internal fields that are still public on an exported class), constructors,
   and the `override name = "…"` line on an error class. A **first-party** type
   that appears in a public signature must **itself be exported and
   documented** — never leave a `private-type-ref` to one of the package's own
   types. Verify with `deno doc --lint` run over **all of a package's
   entrypoints in one invocation** (a multi-entrypoint package like `@zuke/core`
   has `.`, `./shell`, `./tooling`, `./render`, so
   `deno doc --lint packages/core/mod.ts packages/core/src/shell.ts …` — linting
   them together lets cross-entrypoint references resolve). The bar: zero
   `missing-jsdoc` and zero `private-type-ref` to a first-party type. The one
   acceptable residual is a `private-type-ref` into **another published
   `@zuke/*` package** (e.g. a wrapper referencing `Configure` / `CommandOutput`
   from `@zuke/core`) — that dependency documents the type and JSR links to it,
   exactly as the existing tool wrappers do; **do not re-export a dependency's
   type just to silence the lint.** Both `missing-jsdoc` and first-party
   `private-type-ref` lower the package's JSR documentation score. Match the
   existing density and tone when adding docs.
5. **Tests are hermetic and fast.** No network, no reliance on ambient tools.
   When a test needs a subprocess, invoke `Deno.execPath()` (the running
   `deno`), which is always present and shell-free.
6. **Public API is task-shaped — no standalone utility functions.** A package
   exposes its operations through a namespaced `*Tasks` object (`FileTasks`,
   `DenoTasks`, `JsrTasks`, …), never as bare exported helper functions. CLI
   wrappers build argv through the settings-lambda style (`ToolSettings` /
   `buildArgs`); task groups that run no subprocess (e.g. `FileTasks`) take
   direct arguments plus an options object. Group related operations under one
   task object rather than adding a loose function to `mod.ts`, and keep
   internal helpers unexported. (The framework primitives a build is defined
   with — `Build`, `target`, `group`, `run` — are the deliberate exception.)
7. **Mirror the real CLI.** Name a wrapper's task methods and settings after the
   actual subcommands and flags they invoke — `CspellTasks.lint` runs
   `cspell
   lint`, not a prettier alias like `check`. Staying close to the
   tool's own vocabulary keeps the wrapper predictable for anyone who knows the
   CLI.
8. **One domain per file — never the whole implementation in one module.** Split
   a package's source into small, cohesive files by class and concern (types,
   errors, each fluent settings class, the transport/provider layer, parsing,
   the orchestrator), and re-export the public surface from `mod.ts`. A single
   file accreting every class and helper is a smell — break it up as it grows,
   not later. Prefer reusing core primitives (`FileTasks`,
   `glob`/`globToRegExp`, the `$`/`Command` shell, the HTTP helpers) over
   re-implementing them in a package.

## Commands

| Task                          | Command                                 |
| ----------------------------- | --------------------------------------- |
| Run tests                     | `deno task test`                        |
| Coverage + gate (95%)         | `deno task cov`                         |
| Human-readable coverage table | `deno task cov:report`                  |
| Type-check everything         | `deno task check`                       |
| Format / check formatting     | `deno task fmt` / `deno task fmt:check` |
| Lint                          | `deno task lint`                        |
| Spell-check                   | `deno task spell`                       |
| Full pre-commit / CI gate     | `deno task ci`                          |

## Repository layout

```
deno.json                 # workspace root: tasks, fmt/lint config
packages/
  core/                   # @zuke/core — mod.ts, src/, tests/ (+ ./shell, ./tooling)
  deno/                   # @zuke/deno — DenoTasks
  npm/                    # @zuke/npm  — NpmTasks
  cmd/                    # @zuke/cmd  — CmdTasks (generic fallback)
zuke.ts                   # Zuke's own build (runnable example)
.github/workflows/ci.yml  # PR checks
```

## Architecture notes

- **Targets are class fields.** Dependencies are passed as `this.x` references,
  not strings, for compile-time safety and rename support. Because class fields
  initialise top-to-bottom, **a target may only depend on siblings declared
  above it** — a forward reference is `undefined` and is reported as an error by
  `validateReferences`.
- **Naming** is recovered by `discoverTargets`, which introspects the instance's
  own enumerable properties after construction.
- **Ordering** is a DFS topological sort in `graph.ts` that also honours the
  soft `before`/`after` hints and detects cycles (reporting the path).
- **The shell `$`** tokenises interpolated values into discrete argv entries
  (never a concatenated shell string), so command construction is
  injection-free.
- **Tool wrappers** (`@zuke/deno`, `@zuke/npm`, `@zuke/cmd`) follow a
  settings-lambda style. Settings classes extend `ToolSettings` from
  `@zuke/core/tooling`; `buildArgs()` must stay pure (no I/O) so argv
  construction is unit-testable. Execution reuses `Command` from `shell.ts`. New
  wrapper packages are workspace siblings that depend only on core.

## Good open-source practices to follow

- **Small, focused changes** with clear, descriptive commit messages (imperative
  mood; explain the _why_). Keep PRs reviewable.
- **Conventional, semantic versioning** for releases; keep a changelog as the
  project grows.
- **PR titles are the release trigger — make them conventional commits.** This
  repo **always squash-merges**, so the squashed commit's subject is the PR
  title, and that single subject is the only thing release-please parses for the
  merge. A title that is not a conventional commit (e.g. `Add announce tasks`)
  is silently ignored — no version is bumped and no release PR is cut. Title
  every PR `type(scope): summary` so the squash carries the right artifact:
  `feat(core): …` for a new feature (minor bump), `fix(deno): …` for a fix
  (patch). The scope is cosmetic; release-please attributes the bump to a
  package by the **files the PR changes** under `packages/<name>/`, so a PR that
  should release a package must touch a file under that package's path with a
  `feat`/`fix` title. (`docs`/`chore`/`refactor`/`test` titles never bump.)
- **Keep code snippets out of commit message bodies.** release-please parses
  every merged commit with a strict conventional-commits parser, and a code
  fragment containing parentheses (e.g. an arrow function) makes it fail to
  parse the whole commit — which silently drops it from the release, so no
  version is bumped. The repo squash-merges, so the squash body comes from the
  PR description/commits: put illustrative code in the PR discussion, and keep
  commit bodies to prose. See [`RELEASING.md`](RELEASING.md).
- **A new package must be added everywhere.** Membership is declared in five
  places that must stay in lock-step: the `deno.json` workspace,
  `.release-please-config.json`, `.release-please-manifest.json`, the `PACKAGES`
  array in `zuke.ts` (the JSR publish loop), and the list in
  `tests/release_config_test.ts`. `tests/release_config_test.ts` enforces that
  they agree — run it after adding a package. Omitting `zuke.ts` means the
  package is released but never published.
- **Update docs with code.** If behaviour changes, update `README.md`, JSDoc,
  and the spec/acceptance criteria in the same PR.
- **Always read the reviewer comments on every PR.** This repo runs AI reviewers
  (`@zuke/ai`) that post their assessments as PR comments (and human reviewers
  do too). Before considering a PR done — and again after each push — fetch and
  read every review comment on it (the AI-review bot comments included), and
  address or explicitly respond to each finding. Don't rely on the checks being
  green alone; a passing gate can still carry comments worth acting on.
- **No secrets or machine-specific paths** in the repo or commits. Don't commit
  coverage artifacts (`cov_profile/`, `cov.lcov`) — they're git-ignored.
- **Deterministic output.** Topological order is declaration-stable; keep it
  that way so `graph`/`--list` output doesn't churn.
- **Friendly errors.** Validation failures should name the offending target and
  explain the fix (see the cycle and forward-reference messages for the bar).
- **Don't expand the public API casually.** Internal fields use a trailing
  underscore (`name_`, `dependsOn_`); only add to `mod.ts` deliberately. When a
  type does belong in a public signature, though, export and document it rather
  than leaving it an undocumented private-type reference (see guideline 4).
