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
| `.triggers(...targets)`  | `(...t: Target[]) => this`                  | Pull these into the plan and run them _after_ this.    |
| `.dependentFor(...targets)` | `(...t: Target[]) => this`               | Reverse of `dependsOn`: run this _before_ those.       |
| `.inputs(...paths)`      | `(...p: PathLike[]) => this`                | Cache inputs: skip the target when these are unchanged. |
| `.outputs(...paths)`     | `(...p: PathLike[]) => this`                | Cache outputs: a hit also requires these to still exist. |
| `.onlyWhen(condition)`   | `(c: () => boolean \| Promise<boolean>) => this` | Run only when the condition holds, else skip.    |
| `.requires(...params)`   | `(...p: Parameter[]) => this`               | Fail the target unless these parameters are set.       |
| `.proceedAfterFailure()` | `() => this`                                | Keep the build going if this target fails.             |
| `.always()`              | `() => this`                                | Run for cleanup even after the build has failed.       |
| `.unlisted()`            | `() => this`                                | Hide the target from `--list`/`--help`.                |
| `.cacheKey(fn)`          | `(fn: () => string \| Promise<string>) => this` | Extra (non-file) input to the cache fingerprint. |
| `.produces(...paths)`    | `(...p: PathLike[]) => this`                | Declare artifact paths this target produces.           |
| `.consumes(...targets)`  | `(...t: Target[]) => this`                  | Depend on targets and use their `produces` artifacts.  |
| `.whenSkipped(behavior)` | `("run-dependencies" \| "skip-dependencies") => this` | On skip, also skip exclusive deps.    |
| `.timeout(ms)`           | `(ms: number) => this`                      | Fail the body if it runs longer than `ms` (per attempt). |
| `.retry(times, delayMs?)`| `(times: number, delayMs?: number) => this` | Retry the body on failure, optionally pausing between. |

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

### `group()` and `.partOf()`

`group()` creates a parallel **batch**. A target joins it with `.partOf(group)`;
members of the same group run concurrently with one another — even when the
build is otherwise sequential — each still waiting for its own dependencies.
Pass the group to another target's `.dependsOn(...)` to depend on every member
at once.

```ts
checks = group();

clean = target().executes(/* ... */);
lint = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
format = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
typecheck = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);

deploy = target()
  .dependsOn(this.checks) // waits for lint, format, and typecheck
  .executes(/* ... */);
```

Here `clean` runs first (all three depend on it), then `lint`/`format`/
`typecheck` run together, then `deploy`. Grouping is a property of the members,
so they batch whenever they run — no `--parallel` flag needed. Ungrouped
targets stay serialized unless you opt the whole build into `--parallel`.
Declare the group field above the targets that join it.

### Reusable components

A **component** is just a function that returns a bundle of related targets.
Assign it to a build field; discovery recurses into the bundle and names each
target with a dotted path (`release.publish`), runnable as `zuke release.publish`
and shown in the graph. Components compose, nest, and take options.

```ts
// A shared, configurable component.
function releasable(opts: { registry: string }) {
  const pack = target().executes(/* ... */);
  const publish = target()
    .dependsOn(pack)
    .executes(async () => {
      await $`npm publish --registry ${opts.registry}`;
    });
  return { pack, publish };
}

class MyBuild extends Build {
  release = releasable({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* ... */);
}
```

Targets reference each other across components via the field (`this.release.publish`),
so declare a component field above anything that depends on it. Components can
also declare [parameters](./parameters.md) — they're discovered under the same
dotted path.

### Incremental caching — `.inputs()` / `.outputs()`

A target that declares **inputs** becomes incremental: Zuke fingerprints those
files/directories (SHA-256 of their contents, directories hashed recursively)
and **skips** the target — reporting it `cached` — when the fingerprint is
unchanged since the last successful run and every declared **output** still
exists. Otherwise it runs and refreshes the fingerprint.

```ts
compile = target()
  .inputs("src", "deno.json") // re-run only when these change…
  .outputs("dist") // …or when dist is missing
  .executes(async () => {
    await DenoTasks.run((s) => s.script("build.ts"));
  });
```

Fingerprints live in `<repo root>/.zuke/cache.json` (git-ignored). A target with
no inputs always runs. Pass `--no-cache` (or `execute(..., { cache: false })`)
to ignore the cache and rebuild everything. A skipped/cached target counts as
satisfied, so its dependents still run.

### Conditional execution — `.onlyWhen()`

`.onlyWhen(condition)` runs the target only when the condition holds; otherwise
it is skipped (and its dependents still run). The predicate may be async and can
read resolved [parameters](./parameters.md) or the environment. Repeatable — all
conditions must hold.

```ts
deploy = target()
  .onlyWhen(() => this.environment.value === "production")
  .executes(/* ... */);
```

### More target options

- **`.triggers(...targets)`** — the inverse of `dependsOn`: running this target
  pulls the listed targets into the plan and runs them _after_ it (e.g. a
  `notify` target triggered by `deploy`).
- **`.dependentFor(...targets)`** — declare this target as a prerequisite of
  others without editing them: each listed target gains this one as a
  dependency. Declare the listed targets above this one.
- **`.requires(...params)`** — fail the target (with a message naming the
  parameter) unless each listed [parameter](./parameters.md) resolved to a
  value. Use it for a parameter that is optional build-wide but mandatory here.
- **`.proceedAfterFailure()`** — if this target fails, keep running the rest of
  the build instead of aborting. The build still reports failure, and this
  target's own dependents are skipped.
- **`.always()`** — run even after the build has already failed, for
  cleanup/teardown. It still waits for its own dependencies to complete.
- **`.unlisted()`** — hide a helper target from `--list`/`--help`; it can still
  be run by name or depended on.
- **`.cacheKey(fn)`** — add a non-file value (a parameter, tool version, git
  commit…) to the [cache](#incremental-caching-inputs--outputs) fingerprint, so
  the target also rebuilds when that value changes. Repeatable; may be async.
- **`.produces(...paths)`** / **`.consumes(...targets)`** — declare artifact
  paths a target produces, and (on a consumer) depend on the producers.
- **`.whenSkipped("skip-dependencies")`** — when this target is skipped by a
  condition, also skip dependencies that no other target needs. Its condition is
  evaluated up front, so it must not rely on state produced during the run.
- **`.timeout(ms)`** — fail the target if its body runs longer than `ms`
  milliseconds. The bound is **per attempt**, so it combines with `.retry(...)`.
  A timed-out body cannot be cancelled (JavaScript has no such primitive), so it
  keeps running in the background — but its result is ignored.
- **`.retry(times, delayMs?)`** — retry the body up to `times` more attempts on
  failure, optionally pausing `delayMs` between attempts. The last error
  propagates once the attempts are exhausted.

```ts
flaky = target()
  .timeout(30_000) // each attempt may take up to 30s…
  .retry(2, 1_000) // …retried twice, 1s apart, on failure
  .executes(async () => {
    await $`curl -fsSL https://example.com/health`;
  });
```

### Globbing inputs — `glob()`

`glob(pattern, { cwd? })` expands a pattern to the matching paths (relative to
`cwd`, sorted for determinism). It is dependency-free, walks from the pattern's
static prefix, and does not follow symlinked directories. Supported syntax: `*`
(any run of non-`/`), `**` (any run including `/`), `?` (a single non-`/`), and
brace alternation `{a,b}`.

```ts
import { glob } from "jsr:@zuke/core";

format = target().executes(async () => {
  const sources = await glob("src/**/*.ts");
  await DenoTasks.fmt((s) => s.check().paths(...sources));
});
```

### Dry runs — `--dry-run`

`zuke <target> --dry-run` resolves and prints every target that **would** run —
honouring `--skip` and `onlyWhen` conditions — without executing any body or
touching the [cache](#incremental-caching-inputs--outputs). Use it to preview a
plan before committing to it.

### Assertions — `assert()` / `assertExists()` / `fail()`

Fail a target fast with a clear message when an expectation does not hold.
`assert(condition, message?)` throws when the condition is falsy;
`assertExists(value, message?)` throws on `null`/`undefined` and returns the
value narrowed to its non-nullable type; `fail(message)` always throws. The
async `assertFileExists(path)` / `assertDirectoryExists(path)` check the
filesystem. All throw an `AssertionError`.

```ts
import { assert, assertExists, assertFileExists } from "jsr:@zuke/core";

const token = assertExists(Deno.env.get("TOKEN"), "TOKEN is required");
assert(this.environment.value !== "", "environment must be set");
await assertFileExists("dist/app.js");
```

### HTTP — `httpDownload()` / `httpText()` / `httpJson()`

Fetch over HTTP from a build script, built on the platform `fetch`.
`httpDownload(url, dest)` streams a URL to a file; `httpText(url)` and
`httpJson(url)` return the body. All accept `{ headers, fetch }` (the `fetch`
seam makes them unit-testable) and throw an `HttpError` (carrying `.status`) on
a non-2xx response.

```ts
import { httpDownload, httpJson } from "jsr:@zuke/core";

await httpDownload("https://example.com/tool.tar.gz", ".zuke/tool.tar.gz");
const release = await httpJson<{ tag_name: string }>(
  "https://api.github.com/repos/zuke-build/zuke/releases/latest",
);
```

### Host detection — `isCI()` / `ciHost()`

`isCI()` and `ciHost()` (e.g. `"github-actions"`, `"gitlab-ci"`, `"local"`) let
a build branch on where it runs — e.g. `deploy.onlyWhen(() => isCI())`.

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
