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

- **Check the package catalogue before writing any command.** `llms.txt`'s
  `## Packages` catalogue (raw:
  <https://raw.githubusercontent.com/zuke-build/zuke/master/llms.txt>) and the
  grouped table in
  [`skills/zuke-write-build/references/cheatsheet.md`](./skills/zuke-write-build/references/cheatsheet.md)
  are the only ways to answer "does a `@zuke/<tool>` wrapper exist for this
  CLI?" — per-package `deno doc jsr:@zuke/<package>` can only describe a package
  whose name you already know; it cannot reveal that a package _exists_.
  Reaching for `CmdTasks.exec` (`jsr:@zuke/cmd`) or a raw `$`/`Deno.Command` for
  a tool that has a `@zuke/<tool>` package is a **bug**, not a style choice — it
  discards typed flags, argv purity, and tool resolution.
- **One file with the whole typed surface of every package:**
  [`llms-full.txt`](./llms-full.txt) at the repo root. [`llms.txt`](./llms.txt)
  is the short index.
- **A single wrapper on the command line:** `deno doc jsr:@zuke/<package>` (e.g.
  `deno doc jsr:@zuke/deno`).
- **On each package's JSR page / README:** a generated `## API` section.
- **The CLI surface — commands, flags, and a build's actual targets:** run
  `zuke --help` (or `deno run -A zuke.ts --help`). It prints the usage grammar,
  every reserved command (`graph`, `generate-ci`,
  `completions <print|install> <shell>`, `mcp`, `resume`, `runs`, `cancel`,
  `register`, `doc`) and flag, **plus the current build's targets — with
  descriptions and dependencies — and its parameters.** So an agent asked to set
  up or run a build discovers the real command surface live instead of guessing;
  `zuke --list` is the targets-only view and `zuke --list --json` emits the
  whole surface (commands, flags, targets, parameters) as JSON for tools. The
  written reference is [`docs/cli.md`](./docs/cli.md), and
  [`llms.txt`](./llms.txt) carries a generated `## CLI` section; the same data
  is available in code via the exported `describeCli(build)`.

The mental model:

- A build is a class that **extends `Build`**. Each **target is a class field**
  built with `target()`: `.description(...)`, `.dependsOn(...)`,
  `.executes(async () => { … })`.
- **Dependencies are `this.<field>` references, not strings** —
  `dependsOn(this.lint)`, never `dependsOn("lint")` — so renames and typos are
  compile-time errors. A target may only depend on siblings **declared above
  it** (fields initialise top-to-bottom).
- Make the file runnable with **`await run(MyBuild)`** at the bottom — no
  `if (import.meta.main)` guard; `run` no-ops when the module is imported.
- **Every external tool is a namespaced `*Tasks` object** (`DenoTasks`,
  `NpmTasks`, `DockerTasks`, `GitTasks`, …) configured with a **settings
  lambda** that mirrors the real CLI's flags:

  ```ts
  import { Build, run, target } from "jsr:@zuke/core";
  import { DenoTasks } from "jsr:@zuke/deno";

  class CI extends Build {
    lint = target().executes(async () => {
      await DenoTasks.lint();
    });
    test = target().dependsOn(this.lint)
      .executes(async () => {
        await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
      });
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
- **Distribution:** [JSR](https://jsr.io/) as a workspace of 54 packages:
  `@zuke/core` (exports `.`, `./shell`, `./tooling`, `./tooling/conformance`,
  `./render`, `./conformance`) plus the `@zuke/cli` command, a generic
  `@zuke/cmd` fallback, and 50+ typed tool wrappers and plugins (`@zuke/deno`,
  `@zuke/npm`, `@zuke/docker`, `@zuke/ai`, …). The npm org `@zuke-build` is
  reserved for future npm distribution (1:1 name mapping).
- **No runtime dependencies.** The library is dependency-free; tests use a local
  assertion helper (`packages/core/tests/_assert.ts`) rather than a third-party
  assert library so the suite runs with zero network access. This is a claim
  about the **published packages** — every `packages/*/deno.json` — and it is
  enforced by them declaring none. The build layer is separate and does have
  dependencies: cspell and release-please are installed from npm on demand by
  `installCli`, and the root `deno.json` imports `@std/yaml` for `build/`.
  Nothing under `packages/` may import any of them.

### TypeScript 7 / `tsgo`

The request is to use `tsgo` (the native TypeScript port) **if Deno supports
it.** Status as of 2026-07-30:

- **TypeScript 7.0 shipped (2026-07-08)** and the native Go compiler is no
  longer a side channel: it is the `tsc` in the ordinary `typescript` package.
  `@typescript/native-preview` and the `tsgo` binary name now mean the
  bleeding-edge nightly channel, not "the native compiler".
- **Deno can use it, but only unstably.** `deno check --unstable-tsgo`
  (`DENO_UNSTABLE_TSGO=1`, or `"unstable": ["tsgo"]` in `deno.json`) runs the
  native compiler with Deno's own module resolution. Deno's docs call it "an
  unstable, preview feature" that is not feature-complete — programs that pass
  the default checker can report different results — and say "Don't rely on it
  for CI or release builds yet."

**Therefore:** `deno check` (default compiler) stays the authoritative
type-checker for this repo and for CI. Try `--unstable-tsgo` locally when a
type-check feels slow, but do not put it in the `check` task or the gate until
Deno drops the unstable flag. Do not bolt on a parallel `tsc`/`tsgo` pass that
can't see Deno's module graph.

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
   `deno task ci` (which delegates to `./zuke ci`, the same gate CI runs) before
   committing; it must be green.
3. **Keep test coverage at 95%+ (lines and branches) at all times.** Enforced by
   the coverage gate built into `DenoTasks.coverage` (a `.threshold()` parses
   the lcov report and fails the build), wired up in the `cov` task /
   `zuke coverage` target and in CI. New code needs new tests in the same change
   — see [**Testing**](#testing) for the required layers (always unit +
   integration; e2e for bigger features).
4. **Document every public symbol — JSDoc on ALL of it.** A JSDoc comment is
   required on every exported symbol **and on every public member of an exported
   class or interface**: methods, fields (including the trailing-underscore
   internal fields that are still public on an exported class), constructors,
   and the `override name = "…"` line on an error class. A **first-party** type
   that appears in a public signature must **itself be exported and documented**
   — never leave a `private-type-ref` to one of the package's own types. Verify
   with `deno doc --lint` run over **all of a package's entrypoints in one
   invocation** (a multi-entrypoint package like `@zuke/core` has `.`,
   `./shell`, `./tooling`, `./tooling/conformance`, `./render`, `./conformance`,
   so `deno doc --lint packages/core/mod.ts packages/core/src/shell.ts …` —
   linting them together lets cross-entrypoint references resolve). The bar:
   zero `missing-jsdoc` and zero `private-type-ref` to a first-party type. The
   one acceptable residual is a `private-type-ref` into **another published
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
9. **Every source file starts with the copyright and license header.** ALL new
   files — every `.ts` file (tests, fixtures, and generated-file _templates_
   included), and any launcher or script — open with these two lines (after the
   shebang, where one exists), before everything else:

   ```ts
   // Copyright (c) 2026 the Zuke contributors
   // SPDX-License-Identifier: MIT
   ```

   Shell/PowerShell files use `#` comments for the same two lines. This is the
   per-file copyright and license identification the OpenSSF Best Practices
   criteria require, and it is enforced: `tests/license_headers_test.ts` fails
   the suite on any source file missing the header. A generated file gets its
   header from its template (see `internal/hcl_tool.ts.tmpl`) — put the header
   in the template, never hand-edit generated output.

10. **Configuration is a fluent settings lambda, not an options object.** When
    an API takes more than a trivial amount of configuration, expose it as a
    chainable settings class configured through a lambda — the
    `Configure<S> = (s: S) => S` shape the tool wrappers use — not a positional
    options bag. Prefer
    `.lock((s) => s.lockKey("deploy", repo).withTtl("4h").onConflict(...))` over
    `.lock(key, { ttl, onConflict })`. Each setter returns `this`, the fields
    use the trailing-underscore internal convention (and are still JSDoc'd), and
    the lambda defers evaluation until call time — so a value derived from
    `this.<param>.value` sees the resolved value. This keeps the whole authoring
    surface consistent with `DenoTasks.test((s) => …)`, `service()`, and the CI
    builder, and lets options grow without churning call sites. A single
    required scalar (a path, a name) can still be a direct argument; reach for
    the lambda once there are options to set.

## Testing

Zuke has **three test layers**. **Every change ships tests in the same PR** — at
minimum a **unit** test _and_ an **integration** test; a bigger feature (a new
flow mechanism, or anything with cross-process or cross-OS behaviour) also adds
an **e2e** test. All three obey guideline 5: hermetic and fast, no network, no
ambient tools.

1. **Unit — `packages/<pkg>/tests/*_test.ts`.** One module in isolation, with
   fakes and the local `packages/core/tests/_assert.ts` helper (never a
   third-party assert library). For a tool wrapper, assert the **pure
   `buildArgs()` argv** — do not run the real tool — and call
   `assertWrapperConformance` from `@zuke/core/tooling/conformance`, which
   asserts the wrapper's binary name, its **declared** resolution mode — the
   `resolution` option is required, `"node_modules"` for a JS-ecosystem tool and
   `"path"` for a native one, so every wrapper states its mode rather than
   inheriting a default that could hide a missing `defaultResolution()` — and
   its `ToolNotFoundError` path, so a wrapper cannot silently omit those checks.
   This layer covers a module's branches and a wrapper's flags, and carries the
   bulk of the 95% coverage gate.

2. **Integration — `tests/integration/*_test.ts`.** Drive a _real_ build
   end-to-end through the CLI `main()` entry point using the harness in
   `tests/integration/_harness.ts`: `runCli(BuildClass, args)` returns
   `{ code, out, err }`, and `withStateDir(fn)` provides an isolated temporary
   `ZUKE_STATE_DIR` for durable-state features (`waitsFor`, `lock`, run
   records). Fixtures are small `Build` subclasses defined inside the test,
   recording execution into a local array. Prove the executor / graph / params /
   CLI / wait-resume-state flow works as a whole, not just a unit seam. These
   are ordinary `*_test.ts` files, so they run in the **normal `deno test`
   lane** — every `deno task test` / `ci`, on all three OSes (Ubuntu via
   ci.yml's `ci` job, macOS and Windows via its `test` job's matrix) — and count
   toward coverage.

3. **E2E — `tests/e2e/*_e2e.ts` (+ `tests/e2e/fixtures/`).** For the one thing
   an in-process test cannot prove: genuine **inter-process** behaviour (e.g.
   two real processes racing a resume's compare-and-swap) and real **OS
   boundaries** (Windows file-locking). Spawn real `deno` subprocesses with
   `Deno.execPath()` (guideline 5) against a temp `ZUKE_STATE_DIR`; the fixture
   is a runnable `Build` ending in `await run(...)`. **Name these files
   `*_e2e.ts`** so default `deno test` discovery skips them — they stay out of
   the fast gate. They run only via the `integration` build target in `zuke.ts`
   (add the file to its `DenoTasks.test(...).paths(...)`), which the generated
   `.github/workflows/integration.yml` fans out over the three OS runners.

Naming wrinkle to keep straight: the in-process suite _lives in_
`tests/integration/` but runs in the normal test lane; the build target _named_
`integration` runs the e2e suite. They are different things.

## Adversarial review (every feature)

**Every feature ships an adversarial review before the PR is finalized** — not
just a green gate. After the implementation and its tests pass, run a review
pass that actively tries to **break** the change: bypasses, leaks, race
conditions, unhandled throws, and untested security branches. Have independent
reviewers attack each dimension, **verify every finding against the real code**
(reproduce the exact path — default to refuted if you can't), then fix the
confirmed defects _and add a regression test for each_ before opening the PR.

This is not optional polish: on the MCP authz/audit work an adversarial pass
caught a real authorization bypass, a secret-redaction gap, and a
transport-crashing throw that all passed lint, types, and 95%+ coverage. Fixing
pre-PR beats churning through review findings. It complements — never replaces —
the three test layers above and the "read every reviewer comment" rule below.

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
| Pre-commit gate (same as CI)  | `deno task ci` / `./zuke ci`            |
| Regenerate `deno.lock`        | `deno task lock`                        |
| Verify declared core floors   | `./zuke coreFloorCheck` (needs network) |

`deno task ci` is `deno run -A --frozen zuke.ts ci` — the exact gate the `ci`
job in `ci.yml` runs, so there is one gate, not a hand-maintained subset that
can drift from it. `zuke.ts`'s `ci` target depends on: `format`
(`deno fmt --check`), `lint` (`deno lint`), `spell` (cspell), `coverage`
(type-check, then the test suite with the 95% coverage gate), `coverageUpload`
(skips locally without a `CODECOV_TOKEN`), `apiDocsCheck`, `docLint`,
`snippetsCheck`, `hclSyncCheck`, `pluginSyncCheck`, `skillsCheck`,
`graphDocCheck`, `pluginVersionCheck`, `prBodyLint`, `actionPinCheck`,
`security`, and `lockCheck`. Read `zuke.ts`'s `ci` target for the current,
authoritative list — this is a snapshot, not a second source of truth.

**The lock is part of the gate.** Every entrypoint that loads `zuke.ts` — both
launchers and the root tasks — passes `--frozen`, so a run cannot quietly heal a
stale `deno.lock` by writing the resolutions it is missing. That mattered: a
green gate used to be able to mean "the lock resolves _now that we fixed it_"
while CI, whose checkout has the committed lock, failed with "The lockfile is
out of date". `deno task` resolves the workspace before running its command, so
it can still rewrite the lock ahead of a frozen run; `lockCheck` closes that
from the other side by failing if the run left the lock modified. When you
deliberately change a dependency, run `deno task lock`, review the diff, and
commit the lock **in the same change**.

## Repository layout

```
deno.json                 # workspace root: tasks, fmt/lint config
packages/
  core/                   # @zuke/core — mod.ts, src/, tests/ (+ ./shell, ./tooling, ./tooling/conformance, ./render, ./conformance)
  deno/                   # @zuke/deno — DenoTasks
  npm/                    # @zuke/npm  — NpmTasks
  cmd/                    # @zuke/cmd  — CmdTasks (generic fallback)
  …                       # + 50 more: @zuke/cli, @zuke/docs, @zuke/ai, and tool wrappers (54 total)
tests/
  integration/            # in-process: real builds via the CLI main() + _harness.ts
  e2e/                    # subprocess: *_e2e.ts + fixtures/ (run by the `integration` target)
zuke.ts                   # Zuke's own build (runnable example)
build/                    # reusable helpers behind zuke.ts's targets (docs, publish, snippets, …)
zuke, zuke.ps1            # bootstrap launchers (install Deno, run the build); zuke.json names the build class
docs/                     # long-form guides (linked from the README)
skills/                   # agent skills: zuke-write-build, zuke-setup
plugins/zuke/             # Claude Code + Codex plugin wrapping the skills
gemini-extension.json     # Gemini CLI extension manifest (serves skills/)
.agents/plugins/          # Codex-native marketplace catalog
.github/workflows/ci.yml           # PR checks (ci gate, coreFloorCheck, test matrix)
.github/workflows/integration.yml  # e2e suite on the OS matrix (generated)
.github/workflows/ai-review.yml    # @zuke/ai PR review
.github/workflows/release.yml      # release-please automation
.github/workflows/scorecard.yml    # OpenSSF supply-chain scorecard
.github/workflows/security.yml     # security scanners
.github/workflows/codeql.yml       # CodeQL static analysis (SAST)
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
- **A new package must be added everywhere.** Membership is declared in seven
  places that must stay in lock-step: the `deno.json` workspace,
  `.release-please-config.json`, `.release-please-manifest.json`, the `PACKAGES`
  array in `build/packages.ts` (the JSR publish loop), the package table in
  `README.md`, the list in `tests/release_config_test.ts`, and the landing-page
  catalogue in `build/website_tools.ts` (`TOOL_GROUPS` for a CLI wrapper,
  `CORE_PACKAGES` for an engine or plugin package).
  `tests/release_config_test.ts` and `tests/build_tools_test.ts` enforce that
  all seven agree — run them after adding a package. Omitting `zuke.ts` means
  the package is released but never published; omitting the `README.md` table
  means it is invisible to anyone browsing the repo; omitting
  `build/website_tools.ts` fails the gate, because the website's package grid is
  generated from it by `syncWebsite`.
- **Update docs with code.** If behaviour changes, update `README.md`, JSDoc,
  and the spec/acceptance criteria in the same PR.
- **The agent skills are docs too — and they ship to a marketplace.** `skills/`
  is the source of truth for `zuke-write-build` and `zuke-setup`, published to
  three harnesses: `plugins/zuke/` is the Claude Code plugin (whose manifests
  Codex also reads, alongside the Codex-native
  `plugins/zuke/.codex-plugin/plugin.json` and
  `.agents/plugins/marketplace.json`), and the root `gemini-extension.json`
  makes the repo a Gemini CLI extension that auto-discovers `skills/`. The
  `skillsCheck` gate target validates `skills/` against the Agent Skills spec
  (frontmatter `name` must match the folder), since Codex and Gemini load
  those folders directly. Any change to
  the authoring surface or to a documented guarantee — a new `target()` method,
  a new `Build` override, changed CLI or authorization semantics — must be
  reflected in `skills/zuke-write-build/SKILL.md` and
  `skills/zuke-write-build/references/cheatsheet.md` **in the same PR**. The
  cheatsheet is one of the two canonical answers to "does a wrapper exist?", so
  a new package belongs in its catalogue table as well. Then, in order:
  1. Run `./zuke pluginSync` to regenerate `plugins/zuke/skills/`. Never
     hand-edit the copies — `pluginSyncCheck` fails on drift.
  2. **Bump the plugin version by hand, in all four manifests**:
     `plugins/zuke/.claude-plugin/plugin.json`,
     `plugins/zuke/.codex-plugin/plugin.json`, the entry in
     `.claude-plugin/marketplace.json`, and the root `gemini-extension.json`
     (the `VERSIONED_MANIFESTS` list in `build/plugin_version_check.ts`).
     Clients use the version to decide
     whether an installed plugin is stale, so skills edited without a bump
     simply never reach agents that already hold the old copy. release-please
     does **not** manage `plugins/` — it is not a workspace package and has no
     `deno.json`. Additive skill content is a minor bump; a correction is a
     patch.

  Two gate targets hold this up, so a miss fails the build rather than shipping
  quietly: `pluginVersionCheck` fails when a published skill changed against the
  base branch and the version did not move, and `tests/plugin_manifest_test.ts`
  fails when the manifests disagree. `pluginVersionCheck` is the one part of
  the gate that needs history — it compares against `origin/<PR base>`, or
  `ZUKE_PLUGIN_BASE_REF` when you set one — and it reports itself _skipped_,
  never passed, in a clone that has no base to compare against.
- **Always read the reviewer comments on every PR.** This repo runs AI reviewers
  (`@zuke/ai`) that post their assessments as PR comments (and human reviewers
  do too). Before considering a PR done — and again after each push — fetch and
  read every review comment on it (the AI-review bot comments included), and
  address or explicitly respond to each finding. Don't rely on the checks being
  green alone; a passing gate can still carry comments worth acting on.
- **Quote the finding's id whenever you answer or fix one.** Each `@zuke/ai`
  finding carries a short id (the `Dismiss a false positive` block lists them,
  e.g. `` `m5aqoc5dxg5g` ``). Name it in the reply comment, and in the commit
  message of any fix it prompted. The id is how the reviewer's discussion
  feature anchors your reply: a maintainer comment quoting a finding's id is
  weighed as a rebuttal on the next run, and an accepted refutation stays
  dismissed instead of resurfacing. It is also what makes a reply attributable —
  the reviewers post in **append mode**, so every run's assessment stays on the
  thread as history, and the id ties a reply to the exact finding (and round) it
  answers, telling a genuinely new finding apart from the same concern reworded.
  The ids in the `suppressions(...)` list in `zuke.ts` are the same identifiers,
  used there as the hard override for cross-branch false positives.
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
