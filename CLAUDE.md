# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

Zuke is a code-first, strongly-typed build automation system for Deno/TypeScript
(inspired by [NUKE](https://nuke.build/)).

## Tech stack

- **Runtime & toolchain:** [Deno](https://deno.com/) (2.x). All tooling —
  test runner, formatter, linter, type-checker, coverage — is the built-in
  `deno` CLI. No Node, npm, or external build tools.
- **Language:** TypeScript, strict mode (Deno's default).
- **Distribution:** [JSR](https://jsr.io/) as a workspace of four packages:
  `@zuke/core` (exports `.`, `./shell`, `./tooling`), `@zuke/deno`,
  `@zuke/npm`, `@zuke/cmd`. The npm org `@zuke-build` is reserved for future
  npm distribution (1:1 name mapping).
- **No runtime dependencies.** The library is dependency-free; tests use a
  local assertion helper (`tests/_assert.ts`) rather than a third-party assert
  library so the suite runs with zero network access.

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
2. **All linting, formatting, type-checking, and tests must always pass.**
   Run `deno task ci` before committing; it must be green.
3. **Keep test coverage at 95%+ (lines and branches) at all times.** Enforced
   by `scripts/check-coverage.ts` in the `cov` task and in CI. New code needs
   new tests in the same change.
4. **Document the public API.** Every exported symbol carries a JSDoc comment;
   match the existing density and tone when adding to it.
5. **Tests are hermetic and fast.** No network, no reliance on ambient tools.
   When a test needs a subprocess, invoke `Deno.execPath()` (the running
   `deno`), which is always present and shell-free.

## Commands

| Task | Command |
|---|---|
| Run tests | `deno task test` |
| Coverage + gate (95%) | `deno task cov` |
| Human-readable coverage table | `deno task cov:report` |
| Type-check everything | `deno task check` |
| Format / check formatting | `deno task fmt` / `deno task fmt:check` |
| Lint | `deno task lint` |
| Spell-check | `deno task spell` |
| Full pre-commit / CI gate | `deno task ci` |

## Repository layout

```
deno.json                 # workspace root: tasks, fmt/lint config
packages/
  core/                   # @zuke/core — mod.ts, src/, tests/ (+ ./shell, ./tooling)
  deno/                   # @zuke/deno — DenoTasks
  npm/                    # @zuke/npm  — NpmTasks
  cmd/                    # @zuke/cmd  — CmdTasks (generic fallback)
tests/coverage_test.ts    # tests for the root coverage gate script
scripts/check-coverage.ts # coverage gate
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
- **Tool wrappers** (`@zuke/deno`, `@zuke/npm`, `@zuke/cmd`) follow the NUKE
  settings-lambda style. Settings classes extend `ToolSettings` from
  `@zuke/core/tooling`; `buildArgs()` must stay pure (no I/O) so argv
  construction is unit-testable. Execution reuses `Command` from `shell.ts`.
  New wrapper packages are workspace siblings that depend only on core.

## Good open-source practices to follow

- **Small, focused changes** with clear, descriptive commit messages
  (imperative mood; explain the *why*). Keep PRs reviewable.
- **Conventional, semantic versioning** for releases; keep a changelog as the
  project grows.
- **Update docs with code.** If behaviour changes, update `README.md`, JSDoc,
  and the spec/acceptance criteria in the same PR.
- **No secrets or machine-specific paths** in the repo or commits. Don't commit
  coverage artifacts (`cov_profile/`, `cov.lcov`) — they're git-ignored.
- **Deterministic output.** Topological order is declaration-stable; keep it
  that way so `--graph`/`--list` output doesn't churn.
- **Friendly errors.** Validation failures should name the offending target and
  explain the fix (see the cycle and forward-reference messages for the bar).
- **Don't expand the public API casually.** Internal fields use a trailing
  underscore (`name_`, `dependsOn_`); only add to `mod.ts` deliberately.
