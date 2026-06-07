# Tool Packages — Design

**Date:** 2026-06-07
**Status:** Approved (pending user review of this document)

## Goal

Give Zuke builds a NUKE-style tool-wrapper experience: typed, fluent task
functions (like NUKE's `DotNetTasks`) that build a command line and execute
it, with a generic command fallback for tools that have no dedicated wrapper.
Ship the wrappers as separate packages in a Deno workspace monorepo.

## Decisions (made with the user)

| Question | Decision |
|---|---|
| API shape | NUKE settings lambda: `await DenoTasks.test((s) => s.allowAll())` |
| Fallback meaning | Both: generic builder for unwrapped tools **and** Windows `cmd /c` shim retry for non-spawnable binaries (`npm.cmd`) |
| Subcommand scope | Core set (see Surface below), `.args()` escape hatch for everything else |
| Packaging | Separate packages per tool, Deno workspace monorepo |
| Registry | JSR primary under the `@zuke` scope (already created). npm org `@zuke-build` is reserved and parked for future Node distribution of the same packages |

## Package layout

```
deno.json                  # workspace root + shared tasks (fmt/lint/spell/check/test/cov/ci)
packages/
  core/                    # @zuke/core — Build, target, run, graph, executor, cli
    deno.json              #   exports: ".", "./shell", "./tooling"
    mod.ts
    src/{target,build,graph,executor,cli,shell,tooling}.ts
    tests/
  deno/                    # @zuke/deno — DenoTasks
  npm/                     # @zuke/npm  — NpmTasks
  cmd/                     # @zuke/cmd  — CmdTasks (generic, for unwrapped tools)
zuke.ts                    # Zuke's own build at the root; migrates to DenoTasks
scripts/check-coverage.ts  # shared coverage gate
cspell.json                # stays at root
```

- Tool packages depend **only** on `jsr:@zuke/core` (workspace-resolved
  locally). Future wrappers (`@zuke/git`, `@zuke/docker`, …) are siblings.
- Each tool package: `mod.ts`, `src/`, `tests/`, own `deno.json` with
  `name`/`version`/`exports`.

## Authoring experience

```ts
import { DenoTasks } from "jsr:@zuke/deno";
import { NpmTasks } from "jsr:@zuke/npm";
import { CmdTasks } from "jsr:@zuke/cmd";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile").parallel());
await NpmTasks.run((s) => s.script("build").workspace("app"));
await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```

Every task function has the shape
`(configure?: (s: XSettings) => XSettings) => Promise<CommandOutput>` —
awaiting it runs the process and resolves to the existing `CommandOutput`
from `@zuke/core/shell` (so `.text()`, `code`, `stdout`, `stderr` carry over).

## Core `./tooling` export (new in @zuke/core)

- `ToolSettings` — abstract fluent base:
  - common chainers: `.env(record)`, `.cwd(path)`, `.noThrow()`, `.quiet()`,
    `.toolPath(path)` (binary override), `.args(...extra)` (escape hatch,
    appended last)
  - subclasses implement `buildArgs(): string[]` — **pure**, no I/O, so argv
    construction is unit-testable without spawning
- `runTool(binary, settings)` — assembles argv, constructs a `Command`
  (reusing `src/shell.ts` machinery; argv array end-to-end, never a shell
  string, so injection-free), applies env/cwd/noThrow/quiet, runs.
- Missing-binary fallback chain:
  1. spawn throws `Deno.errors.NotFound` **and** platform is Windows →
     retry once via `cmd /c <binary> <args…>` (covers `.cmd`/`.bat` shims)
  2. still not found → throw a friendly error naming the tool, the command
    attempted, and the fix (install it or set `.toolPath()`)

## Surface (v1)

**`@zuke/deno` — `DenoTasks`** (binary: current `Deno.execPath()` by default):
`run`, `test`, `check`, `fmt`, `lint`, `cache`, `coverage`, `task`.
Typed options per subcommand for common flags — e.g. `test`:
`allowAll()`, `allow(perm, ...values)`, `coverage(dir)`, `filter(pattern)`,
`parallel()`, `failFast()`, `paths(...files)`.

**`@zuke/npm` — `NpmTasks`** (binary: `npm`):
`install`, `ci`, `run`, `exec`, `publish`, `version`.
Typed options — e.g. `run`: `script(name)`, `workspace(name)`,
`ifPresent()`, `scriptArgs(...)` (after `--`); `publish`: `tag(name)`,
`access(level)`, `dryRun()`, `otp(code)`.

**`@zuke/cmd` — `CmdTasks`**:
`exec(tool, configure?)` — generic settings (`args`, plus the base chainers)
for any CLI without a dedicated wrapper.

Anything not covered by a typed option goes through `.args()`.

## Workspace mechanics

- Root `deno.json`: `"workspace": ["packages/core", "packages/deno",
  "packages/npm", "packages/cmd"]`; root tasks run fmt/lint/spell/check
  repo-wide and tests across all members; coverage merges into one lcov and
  the existing 95% gate applies to the combined report.
- CI workflow keeps the same steps, pointed at the workspace root.
- `zuke.ts` stays the runnable acceptance example and dogfoods `DenoTasks`.

## Testing strategy (hermetic, per repo rules)

- **Argv builders:** pure unit tests on each settings class — no processes.
- **Execution path:** spawn `Deno.execPath()` (always present):
  `DenoTasks` tested for real; `NpmTasks`/`CmdTasks` execution tested via
  `.toolPath(Deno.execPath())` plus `eval`-style args.
- **Fallback:** point at a guaranteed-missing binary name; assert the
  friendly error (non-Windows) and the `cmd /c` retry construction
  (unit-level, no real `cmd` needed).

## Error handling

- Non-zero exit → existing `CommandError` semantics (unless `.noThrow()`).
- Missing tool → dedicated error naming tool + remedy (see fallback chain).
- Empty/invalid required settings (e.g. `NpmTasks.run` without `script`) →
  throw at build time with the offending task named, matching the repo's
  friendly-error bar.

## Docs

- README: new Tools section with examples; workspace/monorepo notes.
- README: **"Using Zuke in a Node/npm project"** walkthrough (NUKE-style
  `build/` folder convention). For an existing npm repo:
  1. Prerequisite: install Deno (one-liner per platform; no changes to the
     Node toolchain — Deno only drives the build).
  2. Create a `build/` folder next to `package.json` holding the build
     project: `build/deno.json` (imports `jsr:@zuke/core`, `jsr:@zuke/npm`,
     …) and `build/zuke.ts` defining the targets — keeps Zuke fully out of
     the app's `node_modules`/`package.json` dependencies.
  3. Targets drive the existing npm workflow via `NpmTasks`
     (`install`/`ci`/`run`/`publish`) against the repo root
     (`.cwd("..")` or a configured root path).
  4. Bridge for npm-centric contributors: a `package.json` script such as
     `"build": "deno run -A build/zuke.ts"` so `npm run build -- <target>`
     works without anyone learning Deno commands.
  5. Show `--list`/`--graph` discovery and a minimal example
     (`clean → install → test → pack` pipeline) in the walkthrough.
- CLAUDE.md: layout + commands updated for the workspace.
- Spec `docs/zuke-spec-v0.md`: tool-wrapper roadmap item updated to reflect
  this design.
- Publish-time note: JSR scope is `@zuke`; the reserved npm org
  `@zuke-build` maps 1:1 (`@zuke/core` ↔ `@zuke-build/core`) when npm
  distribution starts.

## Out of scope (v1)

- Publishing automation / npm (dnt) pipeline.
- Wrappers beyond deno/npm/cmd (git, docker — future siblings).
- Broad flag coverage of either CLI beyond the core set.
