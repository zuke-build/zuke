# Authoring API

### `target()`

`target()` returns a chainable `TargetBuilder`. Everything is optional except a
body, which is required before the target can run.

| Method                   | Signature                                   | Purpose                                                |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `.description(text)`     | `(s: string) => this`                       | Summary shown in `--list`.                             |
| `.dependsOn(...targets)` | `(...t: Target[]) => this`                  | Hard prerequisites; run first, transitively.           |
| `.executes(fn)`          | `(fn: () => void \| Promise<void>) => this` | The body. May be async.                                |
| `.before(...targets)`    | `(...t: Target[]) => this`                  | Soft ordering: run before these _if both are planned_. |
| `.after(...targets)`     | `(...t: Target[]) => this`                  | Soft ordering: run after these _if both are planned_.  |

`dependsOn` pulls targets into the plan; `before`/`after` only reorder targets
that are _already_ in the plan — they never pull new targets in.

```ts
lint = target()
  .description("Lint sources")
  .after(this.restore) // if restore is in the plan, run after it
  .before(this.test) // if test is in the plan, run before it
  .executes(async () => {
    await DenoTasks.lint();
  });
```

### `Build`

The base class your build extends. It contributes no targets of its own.

- After construction, Zuke discovers targets by introspecting the instance's own
  enumerable properties (the class fields).
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

## Gotchas

- **Declaration order matters.** Because dependencies are `this.x` references
  and class fields initialise top-to-bottom, a target can only depend on
  siblings **declared above it**. A forward reference is `undefined` at runtime
  and reported as an error. TypeScript also flags it (`TS2729`).
- **A body is required.** Running a target whose `.executes(...)` was never set
  fails fast with a clear message.
- **`default` is a convention**, not a keyword — name a field `default` to opt
  in.
