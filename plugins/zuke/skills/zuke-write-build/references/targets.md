# Targets, groups, parameters

The authoring surface: `target()`, `group()`, components, services, the target
context, fan-out and typed parameters.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **Parallel batches:** `group()` + `.partOf(this.group)` run members
  concurrently; depend on the group to wait for all of them.
- **Reusable bundles:** a _component_ is a function returning related targets;
  assign it to a field and reference members as `this.release.publish`.
- **Long-lived processes:** `service()` models a process that must stay _running
  while dependents execute_ (dev server, database, mock API). Declared and
  depended on like a target, but with a `.start(...)` / `.readyWhen(...)`
  lifecycle instead of `.executes(...)`; the executor starts it, waits until
  ready, then stops it in a `finally` so it never leaks. Detail below.
- **Target context & cancellation:** a body may take a context —
  `.executes((ctx) => …)` — with `ctx.runId`, `ctx.initiator` (who asked for the
  run, unchanged by a resume), `ctx.target`, `ctx.signal` (an `AbortSignal`
  fired when the run is cancelled; a plain `` $`…` `` in the body is `SIGTERM`'d
  automatically), `ctx.state`, `ctx.dryRun`, `ctx.plan()` (the run's planned
  shape — `targets`, `includes(name)`, `dependenciesOf(name)` — so a body can
  ask whether `deploy` was part of what was asked for; it reports the plan,
  never what will actually execute, which is `ctx.outcomeOf(name)`), and
  `ctx.reportSummary({ … })` (`key: value` notes on the target's own row of the
  Build Summary; every test-runner wrapper — `DenoTasks.test`,
  `VitestTasks.run`, `JestTasks.run`, `BunTasks.test`, `NodeTasks.test`,
  `PlaywrightTasks.test`, `CypressTasks.run` — reports its test counts there by
  itself, and the ambient `reportSummary` does the same from code with no
  `ctx`). Zero-argument bodies keep working unchanged. Cancel a run
  programmatically by passing `{ signal }` to `execute`. Detail below.
- **Caching:** `.inputs(...)` / `.outputs(...)` make a target incremental. Add a
  **remote store** to share results across machines (fresh CI, teammates);
  `--affected` runs only targets changed since a git base; `--no-cache` /
  `--no-remote-cache` bypass them. A restore is confined to the target's
  declared `.outputs(...)` (and never `.git`/`.zuke`); a refused archive is a
  cache miss with a warning, not a failure. A cancelled run keeps its cache
  unless a compensation actually rolled something back.
- **Checks while the body runs:** `.validateDuring((s) =>
  s.every("30s").check(errorRate))` runs `Validation`s on an interval while the
  body runs (rounds never overlap); the first throw aborts the body's
  `ctx.signal` (killing its `$` children) and fails the target — so
  `.onFailure(() => "cancel-run")` can roll back. Each check gets a `signal`
  (pass it to `fetch`); a red verdict as the body finishes still counts. Not
  retried by `.retry`; not run under `--dry-run`.
- A `Validation` may carry an optional `preflight(ctx)` — called for every
  validation in the plan before any target, dependencies included, starts; a
  throw refuses the whole run. `zuke <target> --preflight` runs only that phase
  (no target executes, missing parameters tolerated), which is how the AI-review
  command job checks who may start a review before any secret is in reach.
- **Fan-out over a list:** `.forEach(() => this.repos.value, (repo) => ({
  checks: target()…, deploy: target()… }), (s) =>
  s.concurrency(3).continueOnItemFailure())` runs the same pipeline over a
  runtime list — items concurrent, each item's stages sequential. Sub-targets
  are materialised at run time (`parent[item].stage`), each a first-class row in
  the summary and the run record; `continueOnItemFailure()` isolates a failed
  item. An `.onCancel(...)` on a fan-out stage runs per item on cancel
  (item-scoped `ctx.state`, reverse order). See
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).
- **Typed inputs:** `parameter("...")` (with `.number()` / `.boolean()` /
  `.options(...)` / `.secret()` / `.required()`), read as `this.x.value`, gated
  with `.requires(this.x)`. `.array()` composes and comes **last**:
  `.options(...).array()` validates each element, `.number().array()` →
  `number[]`, and a required list is `.required().array()` (required before
  array — `.array().required()` does not typecheck). A parameter may not be
  named so that it renders as a built-in CLI flag (`actor`, `actorKind`,
  `limit`, `target`, `output`, …) or as an MCP control key (`dryRun`, `confirm`,
  `operatorToken`) — the build refuses to load, naming the field. The flag is
  one dash per lower-to-upper transition, and a **digit ends a run of
  capitals**, so `skipE2E` gives `--skip-e2-e`; name it `skipE2e` or declare
  `.flag("--skip-e2e")`, which replaces the derived spelling everywhere.
- **Secrets from a manager:** `parameter(...).secret().from(source)` sources a
  value at run time (e.g. `execSecret(...)` shelling out to a secret CLI) and
  **redacts** it from all of Zuke's output. Detail below.

## `target()` — the fluent builder

Everything is optional except a body (`.executes`) — with four exceptions, all
below: a `service()`, a `.forEach()` fan-out, a `.waitsFor()` gate, and a target
that declares only `.effect(...)` each legitimately have no `.executes(...)`.

| Method                                                                                                   | Purpose                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.description(text)`                                                                                     | Summary shown in `--list`.                                                                                                                                                                   |
| `.dependsOn(...t)`                                                                                       | Hard prerequisites; run first, transitively. Pass `this.<field>`.                                                                                                                            |
| `.executes(fn)`                                                                                          | The body. Sync or async. **Required.** `fn` may take a `TargetContext` (`(ctx) => …`); see below.                                                                                            |
| `.before(...t)` / `.after(...t)`                                                                         | Soft ordering — only reorders targets already in the plan; never pulls new ones in.                                                                                                          |
| `.triggers(...t)`                                                                                        | Pull targets into the plan and run them _after_ this one.                                                                                                                                    |
| `.dependentFor(...t)`                                                                                    | Reverse of `dependsOn`: make this a prerequisite of others.                                                                                                                                  |
| `.inputs(...p)` / `.outputs(...p)`                                                                       | Incremental cache: skip when inputs unchanged and outputs exist.                                                                                                                             |
| `.cacheKey(fn)`                                                                                          | Add a non-file value (version, git sha, param) to the cache fingerprint.                                                                                                                     |
| `.onlyWhen(cond)`                                                                                        | Run only when the (possibly async) predicate holds, else skip. The predicate may take a context: `(ctx) => ctx.plan().includes("deploy")`.                                                   |
| `.whenSkipped("skip-dependencies")`                                                                      | When `onlyWhen` skips this target, also skip deps no other planned target needs. Condition is evaluated up front, so it must not read run-produced state.                                    |
| `.requires(...params)`                                                                                   | Fail unless the listed parameters resolved to a value.                                                                                                                                       |
| `.retry(times, delayMs?)`                                                                                | Retry the body on failure.                                                                                                                                                                   |
| `.timeout(ms)`                                                                                           | Fail the body if it runs longer than `ms` (per attempt).                                                                                                                                     |
| `.lock((s) => s.lockKey(...).withTtl(...))`                                                              | Hold a cross-run lock while running (or, with `s.holdForRun()`, until the run settles); a second run wanting the key fails, or queues with `.waitUpTo(...)`. See below.                      |
| `.waitsFor((s) => s.on(externalSignal(...)))`                                                            | Gate (no body): suspend the run until an external event; resume later. See below.                                                                                                            |
| `.onCancel(() => this.rollback)`                                                                         | Compensation run (reverse order) iff this target succeeded when the run is cancelled. See below.                                                                                             |
| `.onFailure(() => "cancel-run")`                                                                         | Make this target's final failure cancel the run, running the compensations; a thunk returning a target runs it first. See below.                                                             |
| `.effect(name, fn)`                                                                                      | A side effect whose intent is recorded before it runs, so a resume re-drives it. At-least-once. See below.                                                                                   |
| `.forEach(() => items, (item) => ({stage: target()…}), (s) => s.concurrency(3).continueOnItemFailure())` | Fan out a pipeline over a runtime list: items concurrent, stages sequential per item. See below.                                                                                             |
| `.proceedAfterFailure()`                                                                                 | Keep the build going if this target fails.                                                                                                                                                   |
| `.always()`                                                                                              | Run even after the build failed (cleanup/teardown).                                                                                                                                          |
| `.unlisted()`                                                                                            | Hide from `--list`/`--help`; still runnable by name.                                                                                                                                         |
| `.dryRunnable()`                                                                                         | Run this body under `--dry-run` with `$` in echo mode (prints argv, no spawn); others stay skipped.                                                                                          |
| `.validateBefore(...v)` / `.validateAfter(...v)`                                                         | Run `Validation` checks around the body; a throw fails the target.                                                                                                                           |
| `.validateDuring((s) => s.every("30s").check(...v))`                                                     | Run `Validation` checks on an interval while the body runs; the first throw aborts the body's signal and fails the target.                                                                   |
| a `Validation`'s optional `preflight(ctx)`                                                               | Decide whether the run may happen at all: called for every planned validation before any target (dependencies included) starts; a throw refuses the run. `--preflight` runs only this phase. |
| `.recoverWith(...r)` / `.recoverAttempts(n)`                                                             | Run `Remediation`s if the body fails (self-healing); re-run when one asks to. A remediation gets the target name, attempt and error — **no state handle**.                                   |
| `.partOf(group)`                                                                                         | Join a parallel batch (see `group()`).                                                                                                                                                       |
| `.produces(...p)` / `.consumes(...t)`                                                                    | Declare and consume artifact paths.                                                                                                                                                          |
| `.readOnly()`                                                                                            | Advertise the target as query-only over MCP (`readOnlyHint` instead of `destructiveHint`).                                                                                                   |

**Lifecycle hooks** — `override` on the `Build` to observe a run without
wrapping every target: `onStart()` once before anything runs, `onFinish(result)`
once after (success _or_ failure), `onTargetStart(name)` just before a body
executes (not for a skipped or cached target), and `onTargetEnd(name, status)`
after each target settles. All may be async. For exporting rather than
observing, prefer a plugin (see `@zuke/otel`).

**External ordering:** `override extraEdges(targets)` on the `Build` returns
`[before, after]` pairs (from the discovered `targets` map) to impose soft
ordering beyond per-target `.before()`/`.after()` — the seam for feeding an
external dependency graph in. `override orderWith(targets)` is the same, but
**async and resolved per run** (load the graph at run time); its edges merge
with `extraEdges`. Cycle-checked; edges outside the run's set are ignored; both
are honoured by a run and `zuke cancel`, but not by static `graph`/`--list`.

> **Fan-out caveat:** `targets` holds only **class-field targets** — a
> `.forEach()` fan-out's per-item sub-targets (`parent[item].stage`) don't exist
> at plan time, so **per-item ordering across a fan-out is not expressible**
> with `orderWith`/`extraEdges`. Order whole fan-out **waves** instead: split
> the work into one `.forEach()` per wave and chain the waves with `.dependsOn`.
> An edge to a target that isn't in the build (a fan-out item name, a typo, an
> ad-hoc `target()`) is logged as ignored rather than silently dropped.

## `group()` — parallel batches

```ts
checks = group();

clean = target().executes(/* ... */);
lint = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
format = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);

ship = target().dependsOn(this.checks).executes(/* ... */); // waits for all members
```

Members of a group run concurrently with each other (each still awaiting its own
deps), no `--parallel` flag needed. Declare the group field above its members.

## Components — reusable target bundles

A component is a function returning related targets; discovery names them with a
dotted path (`release.publish`).

```ts
function releasable(opts: { registry: string }) {
  const pack = target().executes(/* ... */);
  const publish = target().dependsOn(pack).executes(/* ... */);
  return { pack, publish };
}

class MyBuild extends Build {
  release = releasable({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* ... */);
}
```

## Services — long-lived processes

`service()` models a process that must stay **running while its dependents
execute** (dev server, DB container, mock API). Declared and depended on like a
target, but with a lifecycle instead of `.executes(...)`: the executor starts
it, waits until ready, keeps it alive, then stops it in a `finally` (reverse
order) so a failed test never leaks a process.

```ts
import { Build, run, service, target, tcpReachable } from "@zuke/core";
import { $ } from "@zuke/core/shell";

class E2E extends Build {
  api = service()
    .description("API under test")
    .start(() => $`deno run -A server.ts`.spawn()) // spawn — don't await
    .readyWhen(() => tcpReachable("localhost:8080")); // polled until ready

  test = target()
    .dependsOn(this.api) // started + ready before this runs
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}
```

| Method                      | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `.start(() => handle)`      | Start the process; return a handle with `.stop()`. **Required.** |
| `.readyWhen(() => boolean)` | Readiness probe, polled (200ms) until `true`.                    |
| `.readyTimeout(ms)`         | Wait before failing readiness (default 30s).                     |
| `.stop((handle) => …)`      | Custom teardown; receives what `.start()` returned.              |

The shell's `Command` gains `.spawn()` (starts without awaiting, returns a
`SpawnedProcess` whose `.stop()` sends `SIGTERM`) — a valid handle, so the
common case needs no explicit `.stop()`. `tcpReachable("host:port")` is the
built-in "is the port up yet?" probe. Shares `dependsOn`/`before`/`after`/
`description` with `target()`.

## Target context — `ctx`

A body may accept a `TargetContext`. Zero-argument bodies keep working — the
parameter is optional.

```ts
deploy = target().executes(async (ctx) => {
  ctx.runId; // stable id for the whole run
  ctx.initiator; // who ASKED for the run — { actor, kind, at }, never rewritten
  ctx.target; // "deploy"
  ctx.signal; // AbortSignal, fired when the run is cancelled
  ctx.dryRun; // true under a dry run
  await ctx.state.set({ where: "sit-7" }); // durable metadata — see below
  await ctx.state.trySet({ where: "sit-7" }); // ...same write, false if dropped
  ctx.stateOf("build").get(); // read ANOTHER target's published state
  ctx.signals.get("approved"); // an external signal's payload (see waits)
  ctx.outcomeOf("checks")?.status; // one target's settled outcome, or undefined
  ctx.outcomeOf("test")?.summary; // its Build Summary notes (durable, e.g. Tests/Passed)
  ctx.outcomes(); // every outcome settled SO FAR, keyed by dotted name
  ctx.plan().targets; // every target THIS run planned, in execution order
  ctx.plan().includes("deploy"); // was `deploy` part of what was asked for?
  ctx.plan().dependenciesOf("test"); // what must finish before `test` starts
  ctx.reportSummary({ Version: "3.6.2" }); // a note on THIS row of the Build Summary
});
```

**Summary notes.** `ctx.reportSummary({ key: value, … })` puts `key: value`
pairs on the target's own row of the end-of-build summary, NUKE-style:
`test  Succeeded  8.1s  // Tests: 837 · Passed: 837 · Failed: 0`. Notes
accumulate; a repeated key replaces its value; each renders on one line, in the
terminal and in the Actions job summary. A failed target keeps its notes. Every
test-runner wrapper (`DenoTasks.test`, `VitestTasks.run`, `JestTasks.run`,
`BunTasks.test`, `NodeTasks.test`, `PlaywrightTasks.test`, `CypressTasks.run`)
reports Tests/Passed/Failed (and Skipped/Todo/Flaky when non-zero) itself, and
`DenoTasks.coverage` reports the measured Lines/Branches — a body only adds what
its tools do not. Library code with no `ctx` (a wrapper, a helper) uses the
ambient `reportSummary(pairs)` from `@zuke/core`, which lands on the running
target's row and is a no-op outside a run. Test counts have one shared shape:
`reportTestCounts({ passed, failed, skipped?, todo?, flaky? })` reports `Tests`
(the sum), `Passed`, `Failed`, then `Skipped`/`Todo`/`Flaky` only when non-zero
— the labels every test-runner wrapper uses.

`ctx.outcomes()` is a snapshot, not a live view, and a target that has not
settled is **absent** rather than present with a placeholder — so depend on what
you intend to read (an `.always()` gate reads what ran before it).

**Cancellation.** When the run is cancelled, `ctx.signal` fires and any plain
`` $`…` `` in the body is terminated with `SIGTERM` automatically (the run's
signal is the shell's ambient signal). Pass `ctx.signal` to `.signal(...)` to
cancel a command explicitly; it composes with `.killAfter(ms)`. Cancel a run
with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, the MCP `cancel_run` tool, or
programmatically with `execute(build, root, { signal })` / `cancelRun(build, {
runId })`. A body that ignores its signal and never shells out runs to
completion. Register **compensations** with `.onCancel(...)` (see below) to undo
a target's effect when the run is cancelled.

## Fan-out over a list — `.forEach()`

Run the same pipeline over a runtime list, with per-item isolation and bounded
concurrency.

> **Four combinations throw**, loudly, when the fan-out is materialised — not at
> type-check time, so they are easy to write by accident. A `.forEach()` parent
> may not also declare `.waitsFor()` or `.effect()`, and **no stage** inside the
> fan-out may declare either. A stage _can_ declare `.onCancel()`, which is why
> the restriction is worth stating: the neighbouring features do not compose the
> way the compensation one does. Suspend or record an effect in a target
> **before or after** the fan-out instead.

```ts
import { Build, parameter, target } from "@zuke/core";

class CD extends Build {
  repos = parameter("services").required().array();

  deployBatch = target().forEach(
    () => this.repos.value, // items: thunk, read when the target runs
    (repo) => ({ // ordered pipeline per item (each stage depends on the prev)
      checks: target().executes(() => checkDeployable(repo)),
      deploy: target().executes((ctx) => applyToSit(repo, ctx)),
    }),
    (s) => s.concurrency(3).continueOnItemFailure(),
  );
}
```

- Items run **concurrently** (up to `.concurrency(n)`, default CPU count); each
  item's stages run **sequentially** — the pipeline model, no barrier between
  items.
- `.continueOnItemFailure()` isolates a failed item (its later stages skip, the
  others finish); otherwise the first failure stops the batch. Either way the
  fan-out target fails if any item did.
- Sub-targets are materialised at run time (`deployBatch[<item>].<stage>`), each
  a first-class row in the summary and the
  [run record](durable.md#durable-run-state) (so `zuke runs show` reports
  per-item verdicts). `--list`/`graph` show the one node, annotated `[fan-out]`.
- **Per-item compensation:** an `.onCancel(...)` on a fan-out **stage** runs on
  cancel for each item that had succeeded — or was still in-flight — with its
  own item-scoped `ctx.state`, in reverse order, before the parent's own
  `.onCancel`. The item list must be deterministic (cancel re-materialises it to
  find items).
- Pairs with array params: `.options(...).array()` / `.number().array()` type
  and validate the list before the batch runs.

## Parameters — typed build inputs

<!-- check -->

```ts
import { Build, parameter, target } from "@zuke/core";

class MyBuild extends Build {
  apiKey = parameter("Anthropic API key").secret().required();
  env = parameter("Target environment"); // optional

  deploy = target()
    .requires(this.apiKey)
    .onlyWhen(() => this.env.value === "production")
    .executes(() => {/* use this.apiKey.value */});
}
```

Secrets are masked in CI output. Read a resolved value with `this.x.value`.

Kinds & modifiers: `.number()` → `number`, `.boolean()` → `boolean` (a flag,
defaults to `false`), `.options("a", "b")` restricts a string, `.secret()`
masks + redacts, `.default(v)`/`.required()` set optionality, `.env(NAME)`
overrides the env var, `.flag("--name")` overrides the CLI flag.

Flag/env derivation: one dash (underscore) per lower-to-upper transition, so
`targetEnv` gives `--target-env` / `TARGET_ENV` and `runs.limit` gives
`--runs-limit`. A run of capitals stays together (`apiURL` gives `--api-url`),
but a **digit ends the run** — `skipE2E` gives `--skip-e2-e`, not `--skip-e2e`.
Either name it `skipE2e`, or declare `.flag("--skip-e2e")`. A declared flag
replaces the derived one everywhere (parser, `--help`, JSON surface,
completions, registry descriptor); it must be lowercase letters/digits/dashes
starting with a letter, may not be a built-in, and no two parameters may claim
the same one. The env var is derived separately and is unaffected.

Lists: `.array()` (comma-separated or repeated flag) comes **last** and composes
— `.options("a", "b").array()` validates each element, and `.number().array()`
yields a `number[]`. Order is kind/options → `.required()` → `.array()`: put
`.required()` **before** `.array()` (`.required().array()`), not after —
`.array().required()` fails to typecheck, and a non-required list defaults to
`[]`.

Reserved names: a parameter may not be named so that it renders as a built-in
CLI flag (`actor` → `--actor`, `actorKind` → `--actor-kind`, `limit`, `target`,
`output`, `state`, … — every flag `zuke --help` lists), nor `dryRun`, `confirm`
or `operatorToken` (the MCP run-tool control keys). The build fails to load with
a `ParameterError` naming the field. Only the rendered flag collides, so
`actorName` and a grouped `runs.limit` are fine.

### Secrets from a manager — `.from(source)`

A `.secret()` parameter can be **sourced at run time** so the value never lands
in a shell, `.env`, or CI YAML — and its resolved value is **redacted from all
of Zuke's output**:

```ts
import { execSecret, parameter } from "@zuke/core";

token = parameter("Deploy token")
  .secret()
  .from(
    execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")),
  );
```

The other source is **`fileSecret((s) =>
s.path("/run/secrets/deploy-token"))`**, for a secret mounted as a file by
Kubernetes, Docker, or a systemd credential — no subprocess, and the common
shape for a multi-line value like a private key.

A sourced secret is still an ordinary parameter (flag, env var, `.required()`,
`.number()`); `.from(...)` just adds the run-time provider.
