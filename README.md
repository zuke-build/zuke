<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/zuke-build/zuke/raw/master/assets/logo-white.png" />
  <img width="400px" alt="Zuke" src="https://github.com/zuke-build/zuke/raw/master/assets/logo.png" />
</picture>

> A code-first, strongly-typed build automation system for Deno & TypeScript.

> [!WARNING]
> **Under heavy development — not production ready.** Zuke is pre-1.0 and
> evolving fast. APIs across all `@zuke/*` packages can change without notice
> within `0.x`. Pin exact versions and expect breakage until a `1.0` release.

> [!NOTE]
> **Largely AI-written.** Much of this project — code, tests, and docs — was
> generated with AI assistance. Take it with a grain of salt: review before you
> rely on it, and don't assume anything is battle-tested.

Zuke lets you define builds as a **TypeScript class**. Each target is a class
field declared with a fluent API; targets reference each other by `this.x`
(not strings), forming a dependency graph that Zuke resolves and runs in
topological order. Inspired by [NUKE](https://nuke.build/) for .NET.

- **Runtime:** Deno
- **Packages:** `jsr:@zuke/core` plus typed tool wrappers `jsr:@zuke/deno`,
  `jsr:@zuke/npm`, `jsr:@zuke/cmd` (raw shell via `jsr:@zuke/core/shell`)
- **Build file:** `zuke.ts` in your project root
- **Zero runtime dependencies**

```ts
class MyBuild extends Build {
  compile = target()
    .dependsOn(this.clean, this.restore)
    .executes(async () => { await DenoTasks.check((s) => s.paths("mod.ts")); });
}
```

---

## Table of contents

- [Table of contents](#table-of-contents)
- [Why Zuke](#why-zuke)
- [Install \& run](#install--run)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Authoring API](#authoring-api)
  - [`target()`](#target)
  - [`Build`](#build)
  - [`run()`](#run)
- [Shell wrapper (`$`)](#shell-wrapper-)
- [Tools](#tools)
- [Using Zuke in a Node/npm project](#using-zuke-in-a-nodenpm-project)
- [CLI reference](#cli-reference)
- [Execution semantics](#execution-semantics)
- [Programmatic API](#programmatic-api)
- [Gotchas](#gotchas)
- [Development](#development)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why Zuke

- **Typed, refactor-safe dependencies.** You wire targets together with
  `this.clean`, not `"clean"`. Rename a target and every reference moves with
  it; a typo is a compile error, not a runtime surprise.
- **Just TypeScript.** Your build logic is ordinary async functions with full
  editor support — no YAML, no bespoke DSL.
- **Ergonomic shell.** The `$` tagged template runs processes with sane
  defaults (throw on failure, capture output) and is injection-safe.
- **Small and explicit.** A tiny core: discover targets, build a graph, sort,
  run. No magic, no plugins to learn (yet).

## Install & run

You need [Deno](https://deno.com/) installed. There's nothing else to install —
Zuke is imported straight from JSR.

> [!NOTE]
> All packages — `@zuke/core`, `@zuke/deno`, `@zuke/npm`, `@zuke/cmd`, and the
> `@zuke/cli` command — publish to [JSR](https://jsr.io/@zuke) from CI via
> release-please and OIDC (see [`RELEASING.md`](./RELEASING.md)). The npm scope
> `@zuke` is not controlled by this project — install from JSR, not npm.

### Scaffold a project with `zuke setup`

The fastest start is the `@zuke/cli` tool. Install it once, then scaffold a
starter `zuke.ts`, the `./zuke` launchers, and a `deno.json` task into any
directory:

```sh
deno install -A -g -n zuke jsr:@zuke/cli   # once
zuke setup                                  # in your project
./zuke                                      # run the build
```

Without installing, the same wizard runs via
`deno run -A jsr:@zuke/cli setup` (flags: `--name <Class>`, `--force`, `--yes`).

### Run it yourself

Or just create a `zuke.ts` in your project root and run it with Deno:

```sh
deno run -A zuke.ts <target>
```

The `-A` grants permissions (your targets typically run processes, read/write
files, etc.).

### `./zuke` launcher (no Deno required up front)

For a one-command `./build.sh`-style experience, drop the bootstrap launchers
[`zuke`](./zuke) (bash) and [`zuke.ps1`](./zuke.ps1) (PowerShell) in your repo
root. They locate the project, **install Deno on first use if it's missing**,
then run `zuke.ts` — so a fresh checkout needs nothing but the script:

```sh
./zuke ci          # full gate          (Windows: .\zuke.ps1 ci)
./zuke test        # type-check + tests  (Windows: .\zuke.ps1 test)
./zuke --list      # list every target
```

If you already have Deno, `deno task zuke <target>` (via the `zuke` task in
`deno.json`) does the same thing.

## Quick start

```ts
// zuke.ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class MyBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await Deno.remove("dist", { recursive: true }).catch(() => {});
    });

  restore = target()
    .description("Cache dependencies")
    .executes(async () => {
      await DenoTasks.cache((s) => s.paths("mod.ts"));
    });

  compile = target()
    .description("Type-check and build")
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await DenoTasks.check((s) => s.paths("mod.ts"));
    });

  test = target()
    .description("Run the test suite")
    .dependsOn(this.compile)
    .executes(async () => {
      await DenoTasks.test((s) => s.allowAll());
    });

  // Optional: runs when you invoke `zuke` with no target.
  default = target().dependsOn(this.test).executes(() => {});
}

if (import.meta.main) {
  await run(MyBuild);
}
```

```sh
deno run -A zuke.ts test     # clean → restore → compile → test
deno run -A zuke.ts          # runs `default` (→ test)
deno run -A zuke.ts --list   # show all targets
```

Example output:

```
▶ clean
✔ clean (0.0s)
▶ restore
✔ restore (0.3s)
▶ compile
✔ compile (1.1s)
▶ test
✔ test (2.4s)

✔ SUCCESS — 4/4 targets in 3.8s
```

## Core concepts

| Concept | Description |
|---|---|
| **Build** | A class extending `Build`. Each target is a field. |
| **Target** | A named unit of work: a description, dependencies, and a body. |
| **Dependency graph** | A DAG derived from `.dependsOn(...)`. Cycles are an error. |
| **Plan** | The requested target's transitive dependencies, topologically sorted. |
| **Executor** | Runs the plan sequentially, with timing and pass/fail reporting. |

## Authoring API

### `target()`

`target()` returns a chainable `TargetBuilder`. Everything is optional except a
body, which is required before the target can run.

| Method | Signature | Purpose |
|---|---|---|
| `.description(text)` | `(s: string) => this` | Summary shown in `--list`. |
| `.dependsOn(...targets)` | `(...t: Target[]) => this` | Hard prerequisites; run first, transitively. |
| `.executes(fn)` | `(fn: () => void \| Promise<void>) => this` | The body. May be async. |
| `.before(...targets)` | `(...t: Target[]) => this` | Soft ordering: run before these *if both are planned*. |
| `.after(...targets)` | `(...t: Target[]) => this` | Soft ordering: run after these *if both are planned*. |

`dependsOn` pulls targets into the plan; `before`/`after` only reorder targets
that are *already* in the plan — they never pull new targets in.

```ts
lint = target()
  .description("Lint sources")
  .after(this.restore)   // if restore is in the plan, run after it
  .before(this.test)     // if test is in the plan, run before it
  .executes(async () => { await DenoTasks.lint(); });
```

### `Build`

The base class your build extends. It contributes no targets of its own.

- After construction, Zuke discovers targets by introspecting the instance's
  own enumerable properties (the class fields).
- Optional lifecycle hooks, overridable on your subclass:

```ts
class MyBuild extends Build {
  override onStart() {
    console.log("Build starting…");
  }
  override onFinish(result: BuildResult) {
    console.log(result.ok ? "All good" : "Something failed");
  }
  // …targets…
}
```

`BuildResult` is `{ ok: boolean; executed: string[]; error?: unknown }`.

A field literally named `default` is the **default target**, run when no target
is named on the command line.

### `run()`

```ts
run(BuildClass: new () => Build, args?: string[]): Promise<void>
```

Instantiates the build, discovers targets, validates the graph, parses CLI
arguments (defaulting to `Deno.args`), dispatches to the executor, and calls
`Deno.exit` with `0` on success or `1` on failure. This is the standard entry
point at the bottom of `zuke.ts`.

## Shell wrapper (`$`)

Ergonomic process execution built on `Deno.Command`, imported from the `shell`
submodule:

```ts
import { $ } from "jsr:@zuke/core/shell";

await $`deno test -A`;                              // throws on non-zero exit
const sha   = await $`git rev-parse HEAD`.text();   // trimmed stdout
const files = await $`git diff --name-only`.lines(); // string[]
const code  = await $`flaky-cmd`.noThrow().code();   // exit code, never throws
await $`build`.env({ NODE_ENV: "prod" }).cwd("./app").quiet();
```

| Member | Behaviour |
|---|---|
| `` $`…` `` | Builds a lazy command. Awaiting it runs the process and **throws `CommandError` on non-zero exit** by default. |
| `.text()` | Run; resolve to trimmed stdout. Throws on non-zero (unless `.noThrow()`). |
| `.lines()` | Run; resolve to `string[]` (stdout split on newlines; empty output → `[]`). |
| `.code()` | Run; resolve to the numeric exit code. **Never throws** on non-zero. |
| `.noThrow()` | Suppress throwing on non-zero exit. |
| `.env(record)` | Merge environment variables. |
| `.cwd(path)` | Set the working directory. |
| `.quiet()` | Suppress live stdout/stderr streaming. |

Awaiting a command resolves to a `CommandOutput` (`{ code, stdout, stderr }`,
plus a `.text()` helper for trimmed stdout).

**Safety:** interpolated values become **discrete argv entries** — they are
never spliced into a shell string — so there is no injection surface. Arrays
expand to multiple arguments:

```ts
const files = ["a.ts", "b.ts"];
await $`deno fmt ${files}`;          // → ["deno", "fmt", "a.ts", "b.ts"]
const dirty = "; rm -rf /";
await $`echo ${dirty}`;              // prints the literal string; runs nothing else
```

By default a command streams its output live to your terminal and captures
stdout; `.text()`/`.lines()` capture without echoing; `.quiet()` does neither.

## Tools

Typed tool wrappers in a settings-lambda style: configure a fluent settings
object in a lambda and the task function builds the argv and runs it.
Arguments stay a discrete array end-to-end — never a shell string — so
command construction is injection-free.

```ts
import { DenoTasks } from "jsr:@zuke/deno";
import { NpmTasks } from "jsr:@zuke/npm";
import { CmdTasks } from "jsr:@zuke/cmd";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await NpmTasks.run((s) => s.script("build").workspace("app"));

// Fallback for tools without a dedicated wrapper:
await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
```

Every settings object also supports `.env()`, `.cwd()`, `.noThrow()`,
`.quiet()`, `.toolPath()` (binary override) and `.args()` (escape hatch for
flags without a typed option). Awaiting a task resolves to the same
`CommandOutput` the shell `$` produces. If a binary is missing, Zuke retries
through `cmd /c` on Windows (npm ships as a `.cmd` shim there) and otherwise
raises a `ToolNotFoundError` that names the tool and the fix.

| Package | Tasks |
|---|---|
| `@zuke/deno` | `run`, `test`, `check`, `fmt`, `lint`, `cache`, `coverage`, `task` |
| `@zuke/npm` | `install`, `ci`, `run`, `exec`, `publish`, `version` |
| `@zuke/cmd` | `exec` (any tool) |

## Using Zuke in a Node/npm project

Zuke can drive a Node project's build without touching its dependencies —
build logic in a `build/` folder that lives next to the code. Deno is the only
prerequisite (it runs the build; your app keeps its Node toolchain):

```
my-app/
  package.json          # your app — no zuke dependency added
  src/ ...
  build/
    deno.json           # the build project's config
    zuke.ts             # your targets
```

1. Install Deno: <https://docs.deno.com/runtime/getting_started/installation/>

2. Create `build/deno.json`:

```json
{
  "imports": {
    "@zuke/core": "jsr:@zuke/core@^0",
    "@zuke/npm": "jsr:@zuke/npm@^0"
  }
}
```

3. Create `build/zuke.ts` — targets drive the repo root via `.cwd("..")`:

```ts
import { Build, run, target } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";

class AppBuild extends Build {
  install = target()
    .description("Clean-install dependencies")
    .executes(async () => {
      await NpmTasks.ci((s) => s.cwd(".."));
    });

  test = target()
    .description("Run the app's test script")
    .dependsOn(this.install)
    .executes(async () => {
      await NpmTasks.run((s) => s.script("test").cwd(".."));
    });

  pack = target()
    .description("Verify the publishable tarball")
    .dependsOn(this.test)
    .executes(async () => {
      await NpmTasks.publish((s) => s.dryRun().cwd(".."));
    });

  default = target()
    .description("Default: install → test → pack")
    .dependsOn(this.pack)
    .executes(() => {});
}

if (import.meta.main) {
  await run(AppBuild);
}
```

4. Bridge it for npm-centric contributors — in `package.json`:

```json
{
  "scripts": {
    "build": "deno run -A build/zuke.ts"
  }
}
```

Now `npm run build` runs the default pipeline, `npm run build -- test` runs
one target, and `npm run build -- --list` / `-- --graph` show what the build
can do — no one has to learn Deno commands.

## CLI reference

| Command | Behaviour |
|---|---|
| `zuke <target>` | Run the target and all its transitive dependencies, in order. |
| `zuke <target> --skip <dep>` | Run the target but skip the named dependency (repeatable). |
| `zuke --list` / `-l` | List all targets with descriptions and dependencies. |
| `zuke --graph` | Print the dependency graph (`target → deps`). |
| `zuke --help` / `-h` | Usage. |
| `zuke` (no target) | Run the `default` target if defined, else print `--list`. |

(Read `zuke` as `deno run -A zuke.ts` until the launcher binary ships.)

**Output:** each target prints `▶ name` on start, then `✔ name (1.2s)` or
`✘ name (0.4s)`. A failure prints the error, aborts the remaining targets, and
exits `1`. A final summary reports targets run, total time, and overall status.

## Execution semantics

1. Instantiate the build class.
2. Discover targets by property introspection.
3. Build the dependency graph from `.dependsOn(...)`.
4. **Validate:** an undefined/unknown dependency or a cycle fails fast (with the
   offending path) and exits `1`.
5. Compute the requested target's transitive closure.
6. **Topologically sort** (honouring `before`/`after`); v0 runs **sequentially**.
7. Run each body. On throw, stop and report.
8. Each target runs **at most once** per invocation — diamond dependencies
   dedupe.

## Programmatic API

Beyond authoring, `mod.ts` exports the building blocks if you want to drive Zuke
yourself or test a build:

```ts
import {
  discoverTargets, // (build) => Map<string, TargetBuilder>
  execute,         // (build, rootTarget, options?) => Promise<BuildResult>
  plan,            // (rootTarget) => TargetBuilder[]  (topological order)
  validateGraph,   // (targets) => void  (throws GraphError)
  findCycle,       // (targets) => string[] | null
  executionSet,    // (rootTarget) => Set<TargetBuilder>
  GraphError,
} from "jsr:@zuke/core";
```

`execute` accepts `{ silent?, reporter?, skip? }`. Provide a custom `reporter`
(`{ info(line), error(line) }`) to capture or redirect output.

## Gotchas

- **Declaration order matters.** Because dependencies are `this.x` references
  and class fields initialise top-to-bottom, a target can only depend on
  siblings **declared above it**. A forward reference is `undefined` at runtime
  and reported as an error. TypeScript also flags it (`TS2729`).
- **A body is required.** Running a target whose `.executes(...)` was never set
  fails fast with a clear message.
- **`default` is a convention**, not a keyword — name a field `default` to opt
  in.

## Development

```sh
deno task test        # run the suite
deno task cov         # run with coverage + enforce the 95% gate
deno task cov:report  # print a per-file coverage table
deno task check       # type-check
deno task fmt         # format (fmt:check to verify only)
deno task lint        # lint
deno task spell       # spell-check (cspell)
deno task ci          # everything CI runs: fmt:check, lint, spell, check, cov
```

CI runs `deno task ci` on every push and pull request (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Contributing

- Read [`CLAUDE.md`](CLAUDE.md) for the coding standards (strict typing, no
  `any`/`as`, 95%+ coverage, hermetic tests).
- Run `deno task ci` before opening a PR — it must be green.
- Add tests in the same change as the code they cover.
- Keep commits small and descriptive; update docs when behaviour changes.

## Roadmap

Post-v0, for context:

- Parameter & environment injection (`this.configuration`, `--configuration`).
- Parallel execution of independent targets.
- A `zuke` standalone binary + `zuke init` scaffolding.
- Caching / incremental targets.
- More tool wrapper packages (git, docker helpers) — `@zuke/deno`, `@zuke/npm`,
  and `@zuke/cmd` already ship; see [Tools](#tools).

## License

MIT — see [`LICENSE`](LICENSE).
