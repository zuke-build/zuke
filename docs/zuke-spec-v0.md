# Zuke — Spec v0 (Initial Cut)

A code-first, strongly-typed build automation system for the Deno/TypeScript
ecosystem. Inspired by [NUKE](https://nuke.build/) (.NET). Builds are defined in
TypeScript as a class, targets form a dependency graph, and a CLI resolves and
executes them.

- **Name:** Zuke
- **CLI binary:** `zuke`
- **Runtime:** Deno
- **Distribution:** JSR (`jsr:@zuke/core`)
- **Build files:** `zuke.ts` (project root)

---

## 1. Goals & Non-Goals

### Goals (v0)
- Define builds in TypeScript via a class that extends a `Build` base.
- Declare targets with a **fluent/chained API** (NUKE-style).
- Resolve a **dependency graph** between targets and execute in topological order.
- Provide a **CLI** that lists targets, runs a target (and its dependencies), and
  reports pass/fail with timing.
- Provide **shell/tool wrappers** so targets can run external processes ergonomically.

### Non-Goals (v0 — explicitly deferred)
- Parameter/environment injection into the build class.
- Parallel target execution (v0 runs sequentially).
- Caching / incremental builds / skip-if-unchanged.
- Plugins or third-party tool packages.
- Watch mode.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Build** | A user-defined class extending `Build`. Each target is a property. |
| **Target** | A named unit of work with dependencies and an executable body. |
| **Dependency graph** | Directed acyclic graph derived from `.dependsOn(...)`. Cycles are an error. |
| **Executor** | Resolves order via topological sort, then runs each target's body. |
| **CLI (`zuke`)** | Entry point: parses args, instantiates the build, drives the executor. |

---

## 3. Authoring API (the developer experience)

```ts
// zuke.ts
import { Build, target, run } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";

class MyBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await $`rm -rf dist`;
    });

  restore = target()
    .description("Install dependencies")
    .executes(async () => {
      await $`deno install`;
    });

  compile = target()
    .description("Type-check and build")
    .dependsOn(this.clean, this.restore)
    .executes(async () => {
      await $`deno check mod.ts`;
    });

  test = target()
    .description("Run the test suite")
    .dependsOn(this.compile)
    .executes(async () => {
      await $`deno test -A`;
    });
}

// Make the build runnable: `deno run -A zuke.ts <target>`
if (import.meta.main) {
  await run(MyBuild);
}
```

### 3.1 `target()` fluent builder

Returns a `TargetBuilder` with chainable methods. All are optional except a body
is required before execution.

| Method | Signature | Purpose |
|---|---|---|
| `.description(text)` | `(s: string) => this` | Human-readable summary shown in `zuke --list`. |
| `.dependsOn(...targets)` | `(...t: Target[]) => this` | Declares prerequisites. References sibling targets via `this.x`. |
| `.executes(fn)` | `(fn: () => void \| Promise<void>) => this` | The target body. May be async. |
| `.before(...targets)` | `(...t: Target[]) => this` | *(stretch)* Run before the listed targets if both are in the plan. |
| `.after(...targets)` | `(...t: Target[]) => this` | *(stretch)* Ordering hint without a hard dependency. |

> **Design note for the implementer:** dependencies are declared by passing the
> sibling target *references* (`this.clean`), not strings. This is what gives us
> compile-time safety and rename-refactor support — a key reason we picked the
> class-based model. The framework must be able to map a `TargetBuilder` instance
> back to its property name (e.g. by scanning the instance's own enumerable
> properties after construction).

### 3.2 The `Build` base class

- Provides no targets itself.
- After the subclass is constructed, the framework introspects instance
  properties to discover all `TargetBuilder`s and their names.
- Exposes lifecycle hooks (stretch): `onStart()`, `onFinish(result)`.

### 3.3 `run(BuildClass)`

- Instantiates the build, builds the graph, parses CLI args, dispatches to the
  executor. Sets `Deno.exit` code (0 success, 1 failure).

---

## 4. Shell / Tool Wrappers

Ergonomic process execution built on `Deno.Command`.

```ts
import { $ } from "jsr:@zuke/core/shell";

await $`deno test -A`;                  // throws on non-zero exit
const out = await $`git rev-parse HEAD`.text();  // capture stdout, trimmed
const code = await $`flaky-cmd`.noThrow().code(); // get exit code, don't throw
await $`build`.env({ NODE_ENV: "prod" }).cwd("./app");
```

| Feature | Behaviour |
|---|---|
| Tagged template `$\`...\`` | Runs the command; **throws `CommandError` on non-zero exit** by default. |
| `.text()` | Awaitable; resolves to trimmed stdout. |
| `.lines()` | Resolves to `string[]` split on newlines. |
| `.code()` | Resolves to the numeric exit code. |
| `.noThrow()` | Suppress throwing; combine with `.code()`. |
| `.env(record)` | Merge environment variables. |
| `.cwd(path)` | Set working directory. |
| `.quiet()` | Suppress live stdout/stderr streaming. |

> **Argument safety:** interpolated values in the template MUST be passed as
> discrete argv entries (no shell string concatenation) to avoid injection.
> Arrays interpolate as multiple args.

---

## 5. CLI Surface (`zuke`)

`zuke` is a thin launcher that runs `zuke.ts` with Deno. (v0 may simply document
`deno run -A zuke.ts <target>`; a wrapper binary is a stretch goal.)

| Command | Behaviour |
|---|---|
| `zuke <target>` | Run the target and all its transitive dependencies, in order. |
| `zuke <target> --skip <dep>` | Run the target but skip the named dependency. *(stretch)* |
| `zuke --list` / `-l` | Print all targets, descriptions, and their dependencies. |
| `zuke --graph` | Print the resolved dependency graph (text/ASCII). *(stretch)* |
| `zuke --help` / `-h` | Usage. |
| `zuke` (no target) | Run a `default` target if defined, else show `--list`. |

### Output expectations
- Each target prints a start banner: `▶ compile`.
- On success: `✔ compile (1.2s)`.
- On failure: `✘ compile (0.4s)` + the error, abort remaining targets, exit 1.
- Final summary: total targets run, total time, overall status.

---

## 6. Execution Semantics

1. Instantiate the build class.
2. Discover targets (introspect instance properties).
3. Build the dependency graph from `.dependsOn(...)`.
4. **Validate**: detect cycles → fail fast with the cycle path. Detect a
   `.dependsOn` referencing a non-target → fail.
5. Compute the execution set for the requested target (transitive closure).
6. **Topologically sort**; v0 executes **sequentially**.
7. Run each target body. On throw, stop and report.
8. Each target in a single invocation runs **at most once**, even if multiple
   targets depend on it (diamond dependencies dedupe).

---

## 7. Suggested Project Layout

```
zuke/
├── deno.json                # tasks, imports, JSR config
├── mod.ts                   # public API: Build, target, run
├── src/
│   ├── build.ts             # Build base class + target discovery
│   ├── target.ts            # TargetBuilder fluent API + Target type
│   ├── graph.ts             # topo sort + cycle detection
│   ├── executor.ts          # runs the plan, timing, reporting
│   ├── cli.ts               # arg parsing, --list/--help, run()
│   └── shell.ts             # $ tagged-template wrapper
└── tests/
    ├── graph_test.ts        # cycle detection, topo order, diamonds
    ├── target_test.ts       # fluent builder + discovery
    ├── executor_test.ts     # ordering, dedupe, failure abort
    └── shell_test.ts        # exit codes, capture, noThrow
```

---

## 8. Acceptance Criteria (v0 "done")

- [ ] A `zuke.ts` like §3 runs via `deno run -A zuke.ts test` and executes
      `clean → restore → compile → test` in a valid order.
- [ ] Diamond dependencies run each shared target exactly once.
- [ ] A dependency cycle is detected and reported with the offending path; exit 1.
- [ ] `--list` shows every target with description and dependencies.
- [ ] A failing target aborts the run and sets exit code 1.
- [ ] `$\`...\`` runs a command, throws on non-zero, and `.text()` captures stdout.
- [ ] Targets are referenced by `this.x` (typed), not strings.
- [ ] Test coverage for graph, executor, target discovery, and shell.

---

## 9. Open Questions (decide before/with implementation)

1. **Target discovery mechanism** — property introspection after construction is
   simplest. Confirm it reliably yields the property name for naming/CLI.
   (Decorators were considered and rejected for v0 to keep the surface minimal.)
2. **`default` target** — convention (a property literally named `default`) or an
   explicit `.isDefault()` marker?
3. **`zuke` binary** — ship a real launcher in v0, or document the
   `deno run` invocation and defer the binary?
4. **Naming collisions** — what if a target property shadows a `Build` base
   member? Reserve a small set of names.

---

## 10. Naming & Availability Notes

- **Name origin:** "Zuke" echoes NUKE (the inspiration) via near-rhyme, without
  leaning on the explosion theme. Coined word → distinctive and ownable in search.
- **Availability (checked, but RE-VERIFY at publish time):** no existing npm
  package named `zuke` and no competing build tool by that name surfaced. Nearby
  but distinct: `zukebox`, `zuck`/`zuck.js`, `zukeeper`, `zudoku` — none are build
  tools, so no conceptual collision.
- **Action items before launch:** reserve `zuke` on npm; claim the JSR scope
  (`@zuke`) or package; grab `zuke.dev` (or similar) early. Registry state can
  change, so confirm rather than trust this snapshot.

---

## 11. Roadmap (post-v0, for context only)

- v0.1: Parameter & env injection (`this.configuration`, CLI `--configuration`).
- v0.2: Parallel execution of independent targets.
- v0.3: `zuke` standalone binary + project scaffolding (`zuke init`).
- v0.4: Caching / incremental targets.
- v0.5: Tool wrapper packages — shipped for deno/npm/cmd; git/docker remain
  future siblings.
