# Zuke authoring cheatsheet

A quick map for writing targets. **Always confirm exact signatures** with
`deno doc jsr:@zuke/<package>`, which resolves the version the project actually
has installed. For breadth — which packages and tasks exist — use
`llms-full.txt`: at the repo root in the Zuke repo itself, or from a consumer
repo <https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
which tracks `master` and so may list symbols not yet in any published release.
This cheatsheet is a summary, not the source of truth.

## `target()` — the fluent builder

Everything is optional except a body (`.executes`) — with four exceptions, all
below: a `service()`, a `.forEach()` fan-out, a `.waitsFor()` gate, and a target
that declares only `.effect(...)` each legitimately have no `.executes(...)`.

| Method                                                                                                   | Purpose                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.description(text)`                                                                                     | Summary shown in `--list`.                                                                                                                                |
| `.dependsOn(...t)`                                                                                       | Hard prerequisites; run first, transitively. Pass `this.<field>`.                                                                                         |
| `.executes(fn)`                                                                                          | The body. Sync or async. **Required.** `fn` may take a `TargetContext` (`(ctx) => …`); see below.                                                         |
| `.before(...t)` / `.after(...t)`                                                                         | Soft ordering — only reorders targets already in the plan; never pulls new ones in.                                                                       |
| `.triggers(...t)`                                                                                        | Pull targets into the plan and run them _after_ this one.                                                                                                 |
| `.dependentFor(...t)`                                                                                    | Reverse of `dependsOn`: make this a prerequisite of others.                                                                                               |
| `.inputs(...p)` / `.outputs(...p)`                                                                       | Incremental cache: skip when inputs unchanged and outputs exist.                                                                                          |
| `.cacheKey(fn)`                                                                                          | Add a non-file value (version, git sha, param) to the cache fingerprint.                                                                                  |
| `.onlyWhen(cond)`                                                                                        | Run only when the (possibly async) predicate holds, else skip.                                                                                            |
| `.whenSkipped("skip-dependencies")`                                                                      | When `onlyWhen` skips this target, also skip deps no other planned target needs. Condition is evaluated up front, so it must not read run-produced state. |
| `.requires(...params)`                                                                                   | Fail unless the listed parameters resolved to a value.                                                                                                    |
| `.retry(times, delayMs?)`                                                                                | Retry the body on failure.                                                                                                                                |
| `.timeout(ms)`                                                                                           | Fail the body if it runs longer than `ms` (per attempt).                                                                                                  |
| `.lock((s) => s.lockKey(...).withTtl(...))`                                                              | Hold a cross-run lock while running; a second run wanting the key fails. See below.                                                                       |
| `.waitsFor((s) => s.on(externalSignal(...)))`                                                            | Gate (no body): suspend the run until an external event; resume later. See below.                                                                         |
| `.onCancel(() => this.rollback)`                                                                         | Compensation run (reverse order) iff this target succeeded when the run is cancelled. See below.                                                          |
| `.effect(name, fn)`                                                                                      | A side effect whose intent is recorded before it runs, so a resume re-drives it. At-least-once. See below.                                                |
| `.forEach(() => items, (item) => ({stage: target()…}), (s) => s.concurrency(3).continueOnItemFailure())` | Fan out a pipeline over a runtime list: items concurrent, stages sequential per item. See below.                                                          |
| `.proceedAfterFailure()`                                                                                 | Keep the build going if this target fails.                                                                                                                |
| `.always()`                                                                                              | Run even after the build failed (cleanup/teardown).                                                                                                       |
| `.unlisted()`                                                                                            | Hide from `--list`/`--help`; still runnable by name.                                                                                                      |
| `.dryRunnable()`                                                                                         | Run this body under `--dry-run` with `$` in echo mode (prints argv, no spawn); others stay skipped.                                                       |
| `.validateBefore(...v)` / `.validateAfter(...v)`                                                         | Run `Validation` checks around the body; a throw fails the target.                                                                                        |
| `.recoverWith(...r)` / `.recoverAttempts(n)`                                                             | Run `Remediation`s if the body fails (self-healing); re-run when one asks to. See AI section.                                                             |
| `.partOf(group)`                                                                                         | Join a parallel batch (see `group()`).                                                                                                                    |
| `.produces(...p)` / `.consumes(...t)`                                                                    | Declare and consume artifact paths.                                                                                                                       |
| `.readOnly()`                                                                                            | Advertise the target as query-only over MCP (`readOnlyHint` instead of `destructiveHint`).                                                                |

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
import { Build, run, service, target, tcpReachable } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";

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
  ctx.target; // "deploy"
  ctx.signal; // AbortSignal, fired when the run is cancelled
  ctx.dryRun; // true under a dry run
  await ctx.state.set({ where: "sit-7" }); // durable metadata — see below
  ctx.stateOf("build").get(); // read ANOTHER target's published state
  ctx.signals.get("approved"); // an external signal's payload (see waits)
  ctx.outcomeOf("checks")?.status; // one target's settled outcome, or undefined
  ctx.outcomes(); // every outcome settled SO FAR, keyed by dotted name
});
```

`ctx.outcomes()` is a snapshot, not a live view, and a target that has not
settled is **absent** rather than present with a placeholder — so depend on what
you intend to read (an `.always()` gate reads what ran before it).

**Cancellation.** When the run is cancelled, `ctx.signal` fires and any plain
`` $`…` `` in the body is terminated with `SIGTERM` automatically (the run's
signal is the shell's ambient signal). Pass `ctx.signal` to `.signal(...)` to
cancel a command explicitly; it composes with `.killAfter(ms)`. Cancel a run
with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, the MCP `cancel_run` tool, or
programmatically with `execute(build, root, { signal })` /
`cancelRun(build, {
runId })`. A body that ignores its signal and never shells
out runs to completion. Register **compensations** with `.onCancel(...)` (see
below) to undo a target's effect when the run is cancelled.

## Durable run state

Persist a run's status and per-target metadata so it survives the process
exiting. **Opt-in** — a plain build writes nothing. Enable a store by (first
wins): `execute(..., { stateStore })` → `override stateStore()` →
`ZUKE_STATE_URL` (+ `ZUKE_STATE_TOKEN`) → `ZUKE_STATE_DIR` → `--state` (defaults
to `.zuke/runs`). Every `ZUKE_*_URL` backend — state, registry, remote cache —
**must be `https:`**: a plaintext one is refused with a named error and exit
code 1, because an on-path attacker who answers it chooses what the build reads
back. Loopback is exempt; `ZUKE_ALLOW_INSECURE_URL=1` opts a deliberate
plaintext endpoint back in.

```ts
import { Build, HttpStateStore, target } from "jsr:@zuke/core";

class CD extends Build {
  override stateStore() {
    return new HttpStateStore({ url: this.url.value, token: this.token.value });
  }
  deploy = target().executes(async (ctx) => {
    await ctx.state.set({ image: tag }); // JSON patch, merged and persisted
    const meta = ctx.state.get(); // read back (this run and later ones)
  });
}
```

- Backends: `FileSystemStateStore(dir)` (single host, dev) and
  `HttpStateStore({ url, token? })` (hosted, production — see
  `docs/state-api.md`). Both dependency-free and pluggable behind `StateStore`.
  A hosted backend is verified with the **conformance kit**
  (`deno run -A jsr:@zuke/core/conformance --url <base> [--token …]`, or
  `checkStateStore`/`checkBuildRegistry` from `@zuke/core/conformance`) — it
  exercises CAS, listing, and TTL-lock semantics. The HTTP clients stamp every
  request with `x-zuke-state-protocol: 1` and fail loudly on a server-declared
  mismatch.
- The run record holds status, the graph shape, resolved **non-secret**
  parameters, and per-target status/timing/metadata. Inspect it from the CLI
  with
  `zuke runs list [--status <s>] [--target <t>] [--since <iso>] [--limit <n>] [--counts]`
  (newest first) and `zuke runs show <id>` (`--json` on both), or
  programmatically with `store.listRuns({ status?, target?, since?, limit? })`
  and `store.getRun(id)`.
- **Retention:** `zuke runs prune --keep <age> --keep-last <n>` deletes only
  **terminal** runs matching neither rule (`--dry-run` to preview); a
  non-terminal run (suspended/running) is never pruned. The FS store owns
  pruning via the CLI; for the HTTP backend retention is the server's job
  (`GET /runs` takes `limit`; `DELETE /runs/:id` is optional). See
  `docs/state.md`.
- **Run leases and reaping.** A run that writes durable state takes a TTL lease
  on its own id and heartbeats it, so two processes cannot both believe they own
  one run — a resume that adopts a run whose lease has lapsed takes it over, and
  the original **stops**: it runs no compensations, settles nothing, and writes
  nothing further, because the run belongs to whoever holds the claim now
  (unwinding would roll back the work the new holder is building on). A claim
  lost _during_ a cancellation's rollback stops that walk where it stands, too.
  A run that cannot take its lease at all — a store that never answers, after
  retries — fails with a named error rather than running unclaimed. A run that
  settles, cancellation included, hands the claim straight back. The lease is
  also how a dead run is told from a slow one: `zuke resume --check` looks at
  `running` runs before it sweeps suspended ones, and a lease it can acquire
  means the holder is gone. Such a run is put back to `suspended` with a reap
  event saying why, and the same pass resumes it — so a process killed mid-run
  has its owed effects driven without an operator stepping in. A run whose lease
  is still being renewed is merely slow, and is left alone. The same sweep also
  finishes runs a dead settler left `cancelling`.
- **Run deadlines.** `override deadline()` on the `Build` gives a run a
  wall-clock budget (`"45m"`, or milliseconds), stamped as `deadlineAt` when it
  starts and pushed forward on resume by however long the run sat parked — so
  time spent waiting at a gate does not count against it. An abandoned run found
  **past** its deadline is not handed back: the reaper settles it `failed` and
  runs its compensations. Without a deadline a reaped run is always returned to
  `suspended` and resumed.
- **Whose run is it — `ZUKE_BUILD_ID`.** A shared store means a sweep sees every
  build's runs, and recovery does not merely read them: a resume runs **this**
  build's target bodies against the record it is handed. The shape checks (build
  class name, root target, graph) cannot separate one `zuke.ts` templated across
  a dozen services — same names, same graph, different bodies. So a run records
  an **origin** at creation: `ZUKE_BUILD_ID`, else `GITHUB_REPOSITORY`, else
  none. Every recovery path (`resume`, `resume --check`, `cancel`, the reaper)
  compares it; a sweep silently **skips** a foreign run (so a cron's exit code
  stays meaningful) and a by-name `resume <id>` / `cancel <id>` **reports** it.
  An origin only ever **narrows** what the shape checks permit — it can refuse a
  run, never claim one — so two builds in one repository, which share the
  repository default, stay separated by the build-name check exactly as before.
  An absent origin on either side abstains rather than refusing, so records
  written before the field existed stay recoverable — which means in a container
  you must set `ZUKE_BUILD_ID` yourself (there is no `GITHUB_REPOSITORY` in a
  CronJob), using the same value everywhere that build runs. Alternatively give
  each build its own URL prefix on the shared service
  (`ZUKE_STATE_URL=https://state/svc-a`) and neither can see the other's runs at
  all. See `docs/orchestration.md`.
- **What a sweep counts as failed.** Not a race it lost: a run another process
  is already driving, one that process finished between the listing and the
  resume, and a run belonging to another build are all skipped and reported,
  never counted. A degraded record _is_ counted, on every sweep, because only an
  operator can decide whether its targets are safe to repeat.
- **Never put secrets in `ctx.state`** — it is stored as plain JSON. Secret
  parameters are excluded from the record and state values are run through the
  redactor, but treat state as a non-secret channel. See `docs/state.md`.

## Cross-run locks

`.lock((s) => …)` takes a **settings lambda** (like the tool wrappers) and
claims an exclusive resource across runs and machines. A second run that wants
the same key **fails** with a `LockConflictError` (naming the holder) — it does
not queue.

```ts
import { Build, target } from "jsr:@zuke/core";

class CD extends Build {
  repo = parameter("service");
  promote = target()
    .lock((s) =>
      s.lockKey("deploy", this.repo.value) // sanitised composite key
        .withTtl("4h") // renewed while running; expires this long after a kill -9
        .onConflict((h) =>
          `${this.repo.value} held by ${h.actor} (run ${h.runId}).`
        )
    )
    .executes(async (ctx) => {/* … */});
}
```

- `s.lockKey(...parts)` sanitises and joins a composite key; `s.key(literal)`
  sets one directly. The lambda runs after params resolve, so the key can read
  `this.<param>.value`.
- Released when the target settles (success, failure, cancellation); `ttl` is
  only the backstop for a killed holder.
- Needs a state store — a build using `.lock()` enables the `.zuke/runs`
  filesystem store by default; use the HTTP backend to share locks across
  machines. See `docs/locks.md`.

## External-event waits

`.waitsFor((s) => …)` makes a target a **gate** (no body): the run proceeds past
it only when the trigger is satisfied; otherwise it **suspends** — the run's
state is saved, independent branches finish, and the process exits 0 — to be
resumed later in a fresh process.

```ts
import { Build, externalSignal, target } from "jsr:@zuke/core";

class Deploy extends Build {
  deploy = target().executes(async (ctx) => {
    await applyToSit();
    await ctx.state.set({ at: "sit-7" }); // only durable state crosses the resume
  });
  awaitQa = target()
    .dependsOn(this.deploy)
    .waitsFor((s) =>
      s.on(externalSignal("qa-approved")) // or resumeWhen(async () => …)
        .timeout("72h")
        .onTimeout(() => this.rollback)
    ); // thunk: sibling compensation target
  promote = target().dependsOn(this.awaitQa).executes((ctx) => {
    const approval = ctx.signals.get("qa-approved"); // the signal's JSON payload
  });
  rollback = target().executes(() => rollBack());
}
```

- Triggers: `externalSignal(name)` (payload read via `ctx.signals`),
  `resumeWhen(fn, { interval? })` (async predicate, re-checked on resume), and
  `githubWorkflow((g) => g.repo(...).workflow(...))` from `@zuke/gh` (dispatches
  an external GitHub Actions workflow, satisfied when it finishes; read its
  per-job result with `readWorkflowResult(ctx.stateOf("<gate>"))`). By default
  it correlates via a marker echoed into the run's `run-name:`; for a workflow
  you can't modify use `.correlate("created-window")` (best-effort). Either way
  it **fails fast** (`.discoveryTimeout(...)`, default 1m) if the run never
  correlates, instead of eating the whole `.timeout()`. The **dispatched**
  workflow has its own contract (marker input, run-name, required inputs) — see
  [The dispatched workflow's contract](#the-dispatched-workflows-contract-githubworkflow)
  below. Write your own trigger against the exported `WaitTrigger` /
  `WaitContext` interface.
- Needs a state store (a build with `.waitsFor()` enables `.zuke/runs` by
  default). A resume is a fresh process, so **only `ctx.state`/`ctx.signals`
  cross the boundary**. See `docs/orchestration.md`.
- Continue a suspended run with
  `zuke resume <id> --signal <name> [--data <json>]` (or
  `zuke resume --check [<id>]` for predicate waits/timeouts). Resumption is
  **exactly-once** (concurrent resumers get `AlreadyResumedError`) and re-runs
  only the not-yet-succeeded targets; `--force-graph` overrides a changed graph.

### The dispatched workflow's contract (`githubWorkflow`)

The gate is only half the wiring — the **target** workflow has a contract, and
each of these three is a deterministic dispatch `422` or a gate that hangs until
timeout:

```yaml
# .github/workflows/e2e.yml — in the repo being dispatched
on:
  workflow_dispatch:
    inputs:
      zuke_marker: {
        required: false,
      } # rename → .markerInput("name") on the gate
# any `required: true` input here must be supplied via .inputs(...) below
run-name: ${{ inputs.zuke_marker }} # the ENTIRE run-name; equality, not substring
```

- **Marker input name.** The marker is dispatched as an input named
  `zuke_marker` by default; a dispatch carrying an input the workflow does not
  declare is `422`ed, so a workflow that names it anything else rejects the
  dispatch. Declare `zuke_marker`, or point the gate at your name with
  `.markerInput("<name>")`.
- **Required inputs.** Every `required: true` input on the target workflow must
  be passed from the gate with `.inputs({ … })` / `.input(name, value)`, or the
  dispatch `422`s. The settings lambda is captured when the build is defined and
  has **no run state** — it can read params but not a value an earlier target
  recorded in `ctx.state`; for a run-time value, write a custom `WaitTrigger`.
- **Strict run-name equality.** Marker mode matches `display_title === marker`
  **exactly, not by substring**. A decorated run-name
  (`run-name: E2E [${{ inputs.zuke_marker }}]`) dispatches fine but never
  correlates — the gate just times out. Echo the marker as the workflow's
  _entire_ `run-name:`, or use `.correlate("created-window")`.

## Cancellation & compensation — `.onCancel()`

Undo a target's effect when the run is cancelled.
`.onCancel(target | () =>
target)` registers a **compensation** that runs **iff
this target succeeded**; on cancel, compensations run in **reverse order** of
the succeeded targets.

```ts
class CD extends Build {
  deploy = target()
    .executes((ctx) => ctx.state.set({ slot: "sit-7" })) // record what it did
    .onCancel(() => this.rollback); // thunk → sibling compensation
  rollback = target().executes((ctx) => tearDown(ctx.state.get().slot));
  gate = target().dependsOn(this.deploy)
    .waitsFor((s) => s.on(externalSignal("approved")));
}
```

- The compensation body's `ctx.state` exposes **the original target's**
  persisted metadata (persist what a rollback needs in `ctx.state` when you do
  the work).
- Cancel with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, or the MCP `cancel_run`
  tool (all run the same walk). A live run aborts on its next state write.
- A compensation that throws is recorded but does **not** stop the walk (cleanup
  is maximal). Cancelling a finished run is a friendly no-op.
- A timed-out `.waitsFor()` can route here: `.onTimeout(() => "cancel-run")`
  cancels the run (running compensations); `.onTimeout(() => this.cleanup)` runs
  that target too. Needs a state store (a build with `.onCancel()` enables
  `.zuke/runs` by default). See `docs/orchestration.md`.

## Durable side effects — `.effect()`

A body that dies partway through leaves no record of what it had already done.
`.effect(name, fn)` records the **intent** to run `fn` in the run record before
`fn` runs, so a resume can see the effect was owed and drive it again. Effects
run after the body, in declaration order; a target may declare effects and no
body at all. Requires a state store, which is enabled automatically — an intent
that cannot be recorded fails the target before the effect runs, by design.

```ts
gate = target().dependsOn(this.checks).always()
  .effect("post-gate", async (ctx) => {
    await postCheckRun(ctx.outcomeOf("checks")?.status === "succeeded");
  });
```

- **At-least-once, not exactly-once.** A process that dies after the side effect
  but before recording it repeats the effect on the re-drive. Write bodies that
  tolerate that — either repeating is harmless, or the far side converges (an
  upsert, not an append). The body's `ctx` is an `EffectContext`: `ctx.effect`
  is the effect's name and **`ctx.redriven`** is true when a previous attempt
  already committed its intent, so a body that cannot be made idempotent can at
  least detect the repeat and check the far side first.
- **Pin the inputs.** A re-drive happens later, sometimes much later, so a body
  that looks up "the current value" of anything acts on a world that has moved
  on. Read what the effect acts on from `ctx.state`/`ctx.stateOf(...)`, written
  by an earlier target and replayed from the record. A parameter is nearly as
  good: an unsupplied one keeps the value the run started with, but a resume
  that passes one explicitly overrides it — so prefer state for a value that
  must not drift.
- **What re-drives it.** An effect owed by a run that suspended for any ordinary
  reason is re-driven by the ordinary resume. A process **killed outright**
  leaves its run `running`, which `zuke resume --check` reaps: it reads the
  run's lease to tell a dead holder from a slow one, returns an abandoned run to
  `suspended`, and resumes it in the same pass (see Run leases above) — unless
  the run is past its `deadline()`, in which case it is settled `failed` and its
  effects are never driven. On a shared store the sweep must share the run's
  origin, or it skips the run and the effect is never driven — see
  `ZUKE_BUILD_ID` above.

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
import { Build, parameter, target } from "jsr:@zuke/core";

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
  a first-class row in the summary and the [run record](#durable-run-state) (so
  `zuke runs show` reports per-item verdicts). `--list`/`graph` show the one
  node, annotated `[fan-out]`.
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
import { Build, parameter, target } from "jsr:@zuke/core";

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
overrides the env var.

Lists: `.array()` (comma-separated or repeated flag) comes **last** and composes
— `.options("a", "b").array()` validates each element, and `.number().array()`
yields a `number[]`. Order is kind/options → `.required()` → `.array()`: put
`.required()` **before** `.array()` (`.required().array()`), not after —
`.array().required()` fails to typecheck, and a non-required list defaults to
`[]`.

### Secrets from a manager — `.from(source)`

A `.secret()` parameter can be **sourced at run time** so the value never lands
in a shell, `.env`, or CI YAML — and its resolved value is **redacted from all
of Zuke's output**:

```ts
import { execSecret, parameter } from "jsr:@zuke/core";

token = parameter("Deploy token")
  .secret()
  .from(
    execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")),
  );
```

The other source is
**`fileSecret((s) => s.path("/run/secrets/deploy-token"))`**, for a secret
mounted as a file by Kubernetes, Docker, or a systemd credential — no
subprocess, and the common shape for a multi-line value like a private key.

A sourced secret is still an ordinary parameter (flag, env var, `.required()`,
`.number()`); `.from(...)` just adds the run-time provider.

## Provisioning tools — hermetic builds

Fetch pinned, checksum-verified tool binaries from the build itself instead of
assuming they're installed. Both return the installed binary's `AbsolutePath`;
hand it to a wrapper's `.toolPath(...)`, to `CmdTasks`, or to `defineTool`
(`jsr:@zuke/core/tooling` — the submodule, not the package root).

```ts
import { toolchain, ToolTasks } from "jsr:@zuke/core";

// One release binary:
bin = target().executes(async () =>
  await ToolTasks.install((s) =>
    s.name("shellcheck").url(shellcheckUrl).checksum(shellcheckSum)
  )
);

// Many at once — release binaries via .tool(), npm packages via .npm():
tools = toolchain((t) =>
  t.tool((s) => s.name("helm").url(helmUrl))
    .npm({ name: "vitest", version: "4.1.9" })
);
// install() returns Map<name, AbsolutePath>; npm packages need `npm` on PATH.
```

`.archive("tar.gz")` or `.archive("zip")` unpacks an archive and copies
`.binaryPath(...)` (default the name) out — zip reading covers the `stored`/
`deflate` methods release assets use, rejects encrypted/zip64 archives, and
blocks zip-slip. `.checksum(sha256)` verifies (the archive's SHA-256 for an
archive, the binary's for `"raw"`) and doubles as the install cache key.

**Multi-file runtimes (Node.js, a JDK, …)** — `ToolTasks.installTree((s) => …)`
(or `toolchain().tree((s) => …)`) keeps the _whole_ extracted tree instead of
one binary, for a runtime that ships several bins plus `lib/`. `.strip(1)`
unwraps the `tool-v1.2.3/` top directory, `.bins("bin/node", "bin/npm")` marks
executables (symlinks preserved). It returns the tree root as a callable
`AbsolutePath`, so `root("bin", "node")` is a binary and `root("bin")` the
directory to put on PATH:

```ts
import { prependPath, ToolTasks } from "jsr:@zuke/core";

const node = await ToolTasks.installTree((s) =>
  s.name("node").archive("tar.gz").strip(1).bins("bin/node", "bin/npm")
    .url(nodeUrl).checksum(nodeSum)
);
prependPath(node("bin")); // node/npm (and node_modules/.bin shims) now on PATH
```

`prependPath(dir)` puts `dir` first on the process `PATH` (idempotent, platform
separator) so every subprocess Zuke spawns — the shell `$`, `Command`, and the
tool wrappers, which inherit `Deno.env` — finds the provisioned tool.

**Resolve from `node_modules/.bin`** — in a Node monorepo where tool binaries
are hoisted to the repo root, a wrapper can find its binary npx-style instead of
needing a `.toolPath(...)`. `.fromNodeModules()` on any settings object walks up
from the working directory for `node_modules/.bin/<tool>` (the `.cmd`/`.bat`
shims on Windows, launched via `cmd /c`) and falls back to `PATH` on a miss;
`.fromPath()` forces `PATH`; and `ZUKE_TOOL_RESOLUTION=node_modules|path` flips
every wrapper repo-wide without touching call sites (a per-call setting wins
over it). An explicit `.toolPath(...)` always wins, so a `toolchain()` pin stays
hermetic. `resolvedArgv()` shows what a run will spawn. See `docs/tools.md`.

## Tool wrappers — the settings-lambda style

Every external tool is a `*Tasks` object; each task takes `(s) => s.…` mirroring
the real CLI's flags. A non-exhaustive map (run `deno doc jsr:@zuke/<pkg>` for
the full task list and settings methods of each):

| Package                                                                                                                          | Object                                           | Typical tasks                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@zuke/core`                                                                                                                     | `FileTasks`, `AnnounceTasks`, `ToolTasks`        | copy/move/remove files; Slack/Teams/Discord posts; install tool binaries                          |
| `@zuke/cli`                                                                                                                      | the `zuke` command                               | not a wrapper — `deno install -A -g -n zuke jsr:@zuke/cli`, then `zuke setup` scaffolds a project |
| `@zuke/console`                                                                                                                  | `ConsoleTasks`                                   | themed console output (headings, notices) so a build never hand-rolls `console.log`               |
| `@zuke/deno`                                                                                                                     | `DenoTasks`                                      | `check`, `test`, `fmt`, `lint`, `cache`, `doc`, `run`, `publish`                                  |
| `@zuke/docs`                                                                                                                     | `DocsTasks`                                      | turn generated API docs into published output                                                     |
| `@zuke/npm`, `@zuke/npx`, `@zuke/bun`, `@zuke/pnpm`, `@zuke/yarn`, `@zuke/node`                                                  | `NpmTasks`, `NpxTasks`, `BunTasks`, ...          | JS package managers + `npx` runner + `node`                                                       |
| `@zuke/cmd`                                                                                                                      | `CmdTasks`                                       | `exec` — generic fallback for any CLI                                                             |
| `@zuke/docker`, `@zuke/docker-compose`                                                                                           | `DockerTasks`, ...                               | build/run/compose                                                                                 |
| `@zuke/git`, `@zuke/gh`                                                                                                          | `GitTasks`, `GhTasks`                            | git and GitHub CLI                                                                                |
| `@zuke/cspell`, `@zuke/eslint`, `@zuke/oxlint`, `@zuke/biome`, `@zuke/dprint`, `@zuke/knip`, `@zuke/dpdm`                        | `*Tasks`                                         | lint/format/spell/dead-code                                                                       |
| `@zuke/tsc`, `@zuke/tsx`, `@zuke/tsc-alias`, `@zuke/tsup`, `@zuke/tsdown`, `@zuke/vite`, `@zuke/turbo`, `@zuke/nx`, `@zuke/nest` | `*Tasks`                                         | TS compile / bundle / monorepo / framework CLIs                                                   |
| `@zuke/openapi-ts`, `@zuke/orval`                                                                                                | `*Tasks`                                         | generate API clients from OpenAPI                                                                 |
| `@zuke/husky`                                                                                                                    | `HuskyTasks`                                     | git hooks                                                                                         |
| `@zuke/jest`, `@zuke/vitest`, `@zuke/playwright`, `@zuke/cypress`                                                                | `*Tasks`                                         | test runners                                                                                      |
| `@zuke/jsr`, `@zuke/codecov`, `@zuke/release-please`                                                                             | `JsrTasks`, `CodecovTasks`, ...                  | publish / coverage upload / releases                                                              |
| `@zuke/kubectl`, `@zuke/helm`, `@zuke/kustomize`, `@zuke/terraform`, `@zuke/tofu`, `@zuke/gcloud`                                | `*Tasks`                                         | infra/deploy                                                                                      |
| `@zuke/security`                                                                                                                 | `*Tasks`                                         | security scanning                                                                                 |
| `@zuke/claude`, `@zuke/codex`, `@zuke/gemini`                                                                                    | `ClaudeTasks`, ...                               | headless AI CLIs                                                                                  |
| `@zuke/ai`                                                                                                                       | `securityReviewer`, ..., `aiFixer`, `agentFixer` | AI review gates + self-healing (see below)                                                        |
| `@zuke/otel`                                                                                                                     | `otel` (a plugin)                                | export runs and targets as OpenTelemetry traces (see below)                                       |

The catalog keeps growing — the package list in `llms.txt`'s `## Packages`
catalogue (or the table above) is the source of truth for **whether a wrapper
exists**; `deno doc jsr:@zuke/<pkg>` only confirms the **shape** of a package
whose name you already know, it cannot tell you one exists. Check the catalogue
before reaching for the fallback below — using `CmdTasks.exec`/`$` for a tool
that has a `@zuke/<tool>` package is a bug, not a style choice.

```ts
await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check().paths("mod.ts"));
await CmdTasks.exec("my-tool", (s) => s.args("--flag", "value")); // no wrapper in the catalogue? last resort: cmd

// Wrong — @zuke/docker has a typed wrapper, so this discards typed flags,
// argv purity, and tool resolution:
await CmdTasks.exec("docker", (s) => s.args("build", "-t", "app", "."));
// Right — check the catalogue, find @zuke/docker, use it:
await DockerTasks.build((s) => s.tag("app").context("."));
```

## AI review & self-healing — `@zuke/ai`

A model becomes part of the build graph two ways. Only the provider (`"claude"`
| `"openai"` | `"gemini"`) and an API key (pass a `parameter().secret()`) are
required; everything else is defaulted.

Neither interface is AI-specific, and neither needs a base class: a
**`Validation`** is any object with a `validate(context)` method (throw to fail
the target), and a **`Remediation`** is any object with a `remediate(...)`
method that repairs the failure and asks for the body to be re-run — the real
build command is the verifier. Write your own wherever a check or a fix is
mechanical rather than a model's job.

**Review gate** — a reviewer is a `Validation`; attach with `.validateBefore` /
`.validateAfter`. It scores the diff and breaks the build past a threshold.

```ts
import { securityReviewer } from "jsr:@zuke/ai";

key = parameter("OpenAI API key").secret();
review = securityReviewer((r) =>
  r.provider("openai").apiKey(this.key).failWhen((g) => g.scoreAbove(8))
);
deploy = target().validateBefore(this.review).executes(() => {/* ... */});
```

Factories: `securityReviewer`, `secretsReviewer`, `correctnessReviewer`,
`licenseReviewer`, `genericReviewer`.

Depth and discussion knobs (all optional, per reviewer):

- `.conventionsFile("AGENTS.md")` — feed the project's conventions document as
  fenced reference material; read from the diff **base** (via `git show`) when
  the diff has one, so a PR cannot rewrite the rules it is judged by.
- `.fileContext()` — also send the changed files' full contents (bounded), so
  the model can check a finding against surrounding guards before reporting.
- `.verify()` — a second, adversarial pass re-checks every candidate finding;
  only a refutation backed by citable contrary evidence removes one (listed in
  the report, never gating), while a candidate the evidence neither confirms
  nor refutes stays reported as `uncertain`.
- `.comment("append")` — post a fresh PR comment per run (history stays on the
  thread) instead of the default single upserted comment per reviewer.
- `.discussion((d) => d.threads())` — anchor each finding to its line as a PR
  **review thread**: the maintainer contests it by replying in that thread (no
  id to quote), and the reviewer replies with the outcome and resolves the
  thread when the finding is dismissed or fixed. The summary comment is still
  posted and still lists every finding, so an unanchorable finding (no line, an
  invented line, a line only present as a deletion) loses nothing — it stays in
  the table and the report's Notes say why. Lines are never guessed at. GitHub
  only; other hosts note it and post the summary alone.
- `.discussion()` — the reviewer engages with the PR thread instead of looping:
  a maintainer contests a finding by replying with its id quoted, an
  adjudication pass weighs the rebuttal on merit, and an accepted dismissal is
  remembered (in a state block inside the reviewer's own comment) so the finding
  — or a rewording — doesn't resurface without new evidence. A rewording is
  caught structurally, not just by asking the model nicely: a finding whose id
  the state doesn't know is compared against the decided findings in the same
  file, and a match adopts that identity, so a dismissal is inherited (shown
  with the earlier title) and a fixed finding reopens under the id the thread
  already knows. The rewording is recorded as an alias, making later rounds
  free. The pass can only rename — same file only, never a more severe finding
  inheriting a less severe one's decision, bounded comparisons per run — and
  every failure leaves the finding reported. It also tracks progress: still-open findings are re-assessed each round, ones that stop
  reproducing are marked fixed and listed cumulatively ("✅ Fixed since first
  review"), and a fixed finding that reappears reopens. Trust is decided in
  code from the host's author metadata (`OWNER`/`MEMBER`/ `COLLABORATOR` by
  default; tune with `.discussion((d) => d.trustAuthors(...))`) — untrusted
  comments never reach the model, which blunts comment-based prompt injection.
  Requires `.comment()`; works on every supported host, each mapping its own
  metadata onto those association names: GitHub uses `author_association`
  verbatim, GitLab derives it from project membership (Owner 50 → `OWNER`,
  Developer/Maintainer 30/40 → `MEMBER`, below that `NONE`), Bitbucket from
  workspace permissions (`owner`/`collaborator`/`member`). **Azure DevOps
  reports no such relationship**, so nobody is trusted there by association —
  name the maintainers with `.trustAuthors(...)`. The mapping fails closed: if
  the membership listing is refused, associations come back empty and only
  `.trustAuthors(...)` admits anyone. `.trustAuthors(...)` takes each host's
  **stable** identifier, never a display name: GitHub `login`, GitLab
  `username`, Azure `uniqueName` (the sign-in address), Bitbucket the account
  **uuid** with braces (`"{9c2c…}"`) — a Bitbucket nickname is a self-assigned,
  non-unique alias and is deliberately not matched. Dismissals persist only
  while the reviewer can recognise its own comment, which on Bitbucket needs an
  app password (a repository/workspace access token is not an account and
  cannot self-identify).

**Self-healing** — `aiFixer` is a `Remediation`; attach with
`.recoverWith(...)`. On a failing body it diagnoses the failure and (safe
default) posts the diagnosis + a committable, Copilot-style inline suggestion to
the PR — writing no files. The build re-runs the real command to verify any
applied fix.

```ts
import { aiFixer } from "jsr:@zuke/ai";

// Per target:
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));

// Or globally — override recoverWith() to attach a fixer to EVERY target:
override recoverWith() {
  return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
}
```

Both compose: a target's own `.recoverWith(...)` runs first, then the
build-level `recoverWith()`. Opt into changes with `.autoApply()` (path
allowlist, file cap, local-only unless `.allowCI()`) and `.commitFixes()`;
`.diff((d) => d.fetchBase())` fetches the PR base branch for context so CI needs
no manual `git fetch`. Keys ride through `parameter().secret()`, which Zuke
masks in CI output.

**Delegate to a coding agent** — `agentFixer(runner)` is a `Remediation` that
hands the failure to a coding agent you inject (`@zuke/claude`, `@zuke/codex`,
`@zuke/gemini`) which edits files itself, then re-runs the target to verify. One
generic fixer, agent chosen at the call site; local-only unless `.allowCI()`.

```ts
import { agentFixer } from "jsr:@zuke/ai";
import { ClaudeTasks } from "jsr:@zuke/claude";

test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(
    agentFixer((ctx) =>
      ClaudeTasks.run((s) => s.prompt(ctx.prompt).permissionMode("acceptEdits"))
    ),
  );
```

## OpenTelemetry export — `@zuke/otel`

A plugin that ships run/target spans and counters to an OTLP/HTTP JSON
collector. Register it on the run, not the build — it observes durable run
state, so a **state store is required**.

```ts
import { run } from "jsr:@zuke/core";
import { otel } from "jsr:@zuke/otel";

await run(MyBuild, {
  plugins: [
    otel((s) =>
      s.endpoint("http://localhost:4318") // else OTEL_EXPORTER_OTLP_ENDPOINT
        .serviceName("my-build") // else OTEL_SERVICE_NAME
        .header("authorization", "Bearer …") // else OTEL_EXPORTER_OTLP_HEADERS
    ),
  ],
});
// Or fully env-driven: run(MyBuild, { plugins: [otel()] })
```

- Exports a **trace** (run span + one child span per executed target) when the
  run settles, plus `zuke.run.started` / `zuke.run.suspended` /
  `zuke.runs{outcome}` counters.
- The trace id is `SHA-256(runId)`, so a **suspend/resume across processes is
  one trace** — the finishing process exports the complete, gap-spanning run.
- **Inert with no endpoint** (safe to always register); **best-effort** (a dead
  collector never fails the build); the record is **secret-free**. No runtime
  deps. See `docs/observability.md`.

## Helpers from `@zuke/core`

- `glob(pattern, { cwd? })` — expand a glob to sorted paths.
- `assert(cond, msg?)`, `assertExists(v, msg?)`, `fail(msg)`,
  `assertFileExists(path)` — fail a target fast with a clear message.
- `httpDownload(url, dest)`, `httpText(url)`, `httpJson(url)` — fetch helpers
  that throw `HttpError` on non-2xx.
- `$` from `jsr:@zuke/core/shell` — injection-safe tagged-template shell, only
  when no typed wrapper fits.

## Code-first CI — `cicd()`

```ts
ci = cicd({ provider: "github" }); // .github/workflows/ci.yml, push/PR to main
```

`provider` is the only required field (`"github"` / `"gitlab"` / `"azure"` /
`"bitbucket"`). Running any target regenerates the YAML; on CI it _verifies_ the
committed file is current (`zuke generate-ci --check` is a dedicated gate).

**Scheduled runs** — `triggers.schedule: [{ cron, tz? }]`. A `tz` (IANA zone) is
compiled to UTC cron(s); a daylight-saving zone also emits a generated guard job
so only the correct wall-clock firing proceeds. Full on GitHub; Azure gets
native `schedules:` for UTC/fixed-offset (DST zone errors); GitLab/Bitbucket
schedules are UI-side and ignored. Numeric fields + whole-hour offsets only,
else a friendly error.
`cicd({ provider: "github", pipeline: { triggers: { schedule: [{ cron: "30 9 * * 1-5", tz: "Europe/Sofia" }] } } })`.

## Run & inspect

```sh
./zuke --list                 # all targets
./zuke --list --json          # whole surface (commands, flags, targets) as JSON
./zuke <target> --dry-run     # preview the plan, run nothing
./zuke <target>               # run it
./zuke <target> --parallel[=N]   # run independent targets concurrently (N caps in-flight)
./zuke <target> --affected[=<base>]  # only targets changed since a git base (default HEAD)
./zuke <target> --skip <dep>  # run it but skip a named dependency (repeatable)
./zuke <target> --no-cache    # ignore the incremental cache
./zuke <target> --state       # persist run state to .zuke/runs (durable state)
./zuke <target> --actor <who> # attribute the run in its state record
./zuke runs list [--status s] # list persisted runs (also --target, --since, --limit, --counts, --json)
./zuke runs show <id>         # one run's full per-target status (+ --json)
./zuke runs prune --keep 90d --keep-last 50  # delete old terminal runs (--dry-run to preview)
./zuke graph [--output=html] [--no-open]  # print the dependency graph, or render it interactively
./zuke generate-ci [--check]  # write the declared CI workflow files (--check verifies instead)
./zuke completions install bash  # wire target/flag completion into your shell (or `print`)
./zuke resume <id> --signal <name> [--data <json>]  # continue a suspended run
./zuke resume --check          # reap abandoned runs, then re-check suspended ones (cron entry point)
./zuke resume <id> --resume-degraded  # continue past a degraded record (a state write was lost)
./zuke cancel <id>            # cancel a run and run its .onCancel() compensations
./zuke mcp [--allow-run]      # serve the build over MCP for an AI client (stdio)
./zuke mcp --http 7777        # ...or over HTTP (loopback; token off-loopback; Origin-guarded)
./zuke mcp --http 7777 --allowed-origin https://app.example  # permit an extra browser Origin
./zuke mcp --allow-run=deploy,checks* --protect deploy --confirm-destructive
                              # authz tiers: allow-list, operator token, confirm
./zuke runs show mcp-audit    # the MCP tool-call audit trail (host only, not served over MCP)
./zuke register [--json]      # record this build in the build registry (idempotent)
./zuke doc jsr:@zuke/deno     # print a package's API (deno doc) from an isolated empty dir
./zuke mcp --registry --allow-run  # serve the registry: registered builds as tools, spawned
./zuke mcp --registry --max-concurrent-runs 4  # cap concurrent run-tool spawns (default 4)
```

**MCP authorization** (`docs/mcp.md`): the two gates have deliberately different
reach. `--allow-run=<globs>` is an **entry-point** control — it decides which
targets a client may invoke, and invoking one runs its dependencies, so
allow-listing `release` allows everything `release` does; scope it to entry
points, not steps. The read tools narrow to match (the allow-listed targets plus
their closure), so a target outside it is unreachable rather than merely
undisplayed. `--protect <globs>` + `ZUKE_OPERATOR_TOKEN` is an **operation**
control, enforced across a run's whole plan: a protected target reached as a
dependency of an unprotected one still requires the token, and that run tool
advertises `operatorToken` as required in its schema. Both fail closed — no
configured token denies every protected target, and a plan that cannot be
resolved (a run record whose root target was deleted) is denied rather than
assumed harmless. The audit trail is operator-only: `show_run` refuses it and
`list_runs` omits it, so the clients it audits cannot read who called what.
`--confirm-destructive` adds a third tier: any target not marked `.readOnly()`
returns its resolved plan until the call repeats with `confirm: true` (a
`dryRun` is exempt) — so mark inspect-only targets `.readOnly()`, which also
advertises MCP's `readOnlyHint` instead of `destructiveHint`.

**Build registry** (`docs/registry.md`): `zuke register` writes a secret-free
descriptor of this build — its `describeCli()` surface (targets, params) plus a
launch location — into a pluggable `BuildRegistry`. Resolved like the state
store: `ZUKE_REGISTRY_URL`/`_TOKEN` (HTTP) or `ZUKE_REGISTRY_DIR` (files), a
`registry()` build override, else `.zuke/builds`. Separate from the run store;
an HTTP backend shares the `/builds` REST contract beside `/runs`.
**`zuke mcp
--registry`** then serves the whole catalog — re-read live, so a
build registered by another process appears as a `run:<buildId>:<target>` tool
with no restart and runs by spawning its launch location (behind `--allow-run` +
the same authz). The run tool exposes the registered build's declared
**parameters** as its input schema and forwards supplied values to the spawned
build as `--flag=value` arguments — validated against their kinds first (a type
mismatch is a clean tool error, never a failed subprocess). `.secret()`
parameters are omitted from the descriptor entirely, so a secret can neither be
requested nor forwarded; the child resolves it from its own environment /
`.from()` source. Because the registry names **where** a build is launched from,
a descriptor whose entry module is **remote** (not a local path or `file:` URL —
`https:`, `jsr:`, `npm:`, `data:`) is refused unless its origin is listed in
`ZUKE_REGISTRY_LAUNCH_HOSTS` (`*` allows any); the call is denied and audited
`launch_origin_not_allowed`, before the confirmation prompt, with nothing
spawned. `zuke register` writes a local `file:` module, so this only bites a
hand-authored or second-party registry entry.

**Trusted per-call identity** (`docs/mcp.md`): on a shared, multi-user endpoint,
`override mcpIdentity()` returns a hook `(ctx) => ({ actor, via? })` that
resolves the **real** caller from a request header an authenticating reverse
proxy injects (`ctx.headers.get("x-forwarded-user")`). It runs once per request
before any dispatch; its actor overrides `--actor`/env/the client label and
flows to the audit trail, run records, lock holders, and a registry-spawned
child's `ZUKE_ACTOR`. A **throwing hook rejects the request** (nothing runs,
nothing is written). The minimal seam — TLS/OAuth/header-stripping is the
proxy's job.

**Caching:** a target with `.inputs(...)`/`.outputs(...)` is incremental
(skipped and reported `cached` when inputs are unchanged and outputs exist). Add
a **remote store** to share results across machines — a fresh CI checkout or a
teammate's clone restores outputs instead of rebuilding; `--no-remote-cache`
uses the local cache only. Declare one with `override remoteCache()` on the
`Build` (returning `FileSystemCacheStore` or `HttpCacheStore`), or leave it and
the executor falls back to the `ZUKE_REMOTE_CACHE_*` environment variables; it
applies only to targets declaring **both** `inputs` and `outputs`. A remote
store is best-effort — an unreachable one never fails the build. A **restore is
confined to the target's declared `.outputs(...)`**, and refuses an absolute or
`..` path, a symlink or directory entry, and anything under `.git`/`.zuke`; a
refused archive is a cache miss (rebuild + warning), never a build failure, so
whoever can write the store can neither plant files nor halt the build.
`--affected` limits a run to targets touched since a git base (great for CI job
fan-out).
