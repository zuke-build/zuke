# Zuke

A code-first, strongly-typed build automation system for the Deno/TypeScript
ecosystem. Inspired by [NUKE](https://nuke.build/). Builds are defined in
TypeScript as a class; targets form a dependency graph; a CLI resolves and
executes them.

See [`docs/zuke-spec-v0.md`](docs/zuke-spec-v0.md) for the full v0 spec.

## Quick start

```ts
// zuke.ts
import { Build, run, target } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";

class MyBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await $`rm -rf dist`;
    });

  compile = target()
    .description("Type-check and build")
    .dependsOn(this.clean)
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

if (import.meta.main) {
  await run(MyBuild);
}
```

```sh
deno run -A zuke.ts test     # clean → compile → test, in order
deno run -A zuke.ts --list   # show targets, descriptions, dependencies
deno run -A zuke.ts --graph  # print the dependency graph
deno run -A zuke.ts --help   # usage
```

> **Declaration order matters.** Dependencies are referenced by `this.x`, and
> class fields initialise top-to-bottom — so a target may only depend on
> siblings declared *above* it. A forward reference is reported as an error.

## Authoring API

`target()` returns a chainable builder:

| Method | Purpose |
|---|---|
| `.description(text)` | Summary shown in `--list`. |
| `.dependsOn(...targets)` | Hard prerequisites (run first, transitively). |
| `.executes(fn)` | The target body. May be `async`. |
| `.before(...targets)` | Soft ordering: run before these, if both are planned. |
| `.after(...targets)` | Soft ordering: run after these, if both are planned. |

`Build` subclasses optionally override `onStart()` and `onFinish(result)`.
A target literally named `default` runs when no target is requested.

## Shell wrapper

```ts
import { $ } from "jsr:@zuke/core/shell";

await $`deno test -A`;                              // throws on non-zero exit
const sha = await $`git rev-parse HEAD`.text();     // trimmed stdout
const files = await $`git diff --name-only`.lines(); // string[]
const code = await $`flaky-cmd`.noThrow().code();    // exit code, no throw
await $`build`.env({ NODE_ENV: "prod" }).cwd("./app").quiet();
```

Interpolated values become discrete argv entries (never spliced into a shell
string), so command construction is injection-free. Arrays expand to multiple
arguments.

## Execution semantics

1. Instantiate the build and discover targets by property introspection.
2. Build the dependency graph from `.dependsOn(...)`.
3. Validate: undefined/unknown references and cycles fail fast (exit 1).
4. Compute the transitive closure of the requested target and topologically
   sort it (v0 runs sequentially).
5. Run each body once — diamond dependencies dedupe.
6. On a thrown error, stop, report, and exit 1.

## Project layout

```
mod.ts            # public API: Build, target, run, execute, graph helpers
src/
  build.ts        # Build base class + target discovery
  target.ts       # TargetBuilder fluent API + Target type
  graph.ts        # topo sort + cycle detection
  executor.ts     # runs the plan, timing, reporting
  cli.ts          # arg parsing, --list/--graph/--help, run()
  shell.ts        # $ tagged-template wrapper
tests/            # graph, target, executor, shell coverage
zuke.ts           # Zuke's own build (runnable example)
```

## Development

```sh
deno task test    # run the suite
deno task check   # type-check
deno task fmt     # format
deno task lint    # lint
```
