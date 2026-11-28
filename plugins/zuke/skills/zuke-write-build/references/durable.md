# Durable runs: state, locks, waits, compensation

Run records, cross-run locks, external-event waits, `.onCancel()` and
`.effect()`.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **Durable run state:** persist a run's status and per-target metadata to a
  pluggable `StateStore` so it survives the process — turn it on with `--state`,
  `ZUKE_STATE_DIR` / `ZUKE_STATE_URL`, or `override stateStore()`. Every
  `ZUKE_*_URL` backend must be `https:` (loopback exempt;
  `ZUKE_ALLOW_INSECURE_URL=1` opts out). In a body, `ctx.state.set({ … })` /
  `ctx.state.get()` records per-target metadata (JSON, **never secrets** —
  secret parameters and redacted values are excluded). `set` awaits the write;
  `ctx.state.trySet({ … })` is the same write reporting `true` when it reached
  the store and `false` when it was dropped — use it before an irreversible step
  that depends on the value. A store-less build and a compensation body always
  see `true` (nothing durable behind them). Inspect persisted runs afterwards
  with `zuke runs list` (filter by `--status`/`--target`/`--since`/`--limit`)
  and `zuke runs show <id>` (`--json` on both). Prune old ones with `zuke runs
  prune --keep <age> --keep-last <n>` (only terminal runs; never
  suspended/running). A run whose process is killed is picked up by `zuke resume
  --check`, which reaps it — its lease tells a dead holder from a slow one — and
  resumes it in the same sweep. A process that merely _looked_ dead and then
  finds its lease taken over **stops**, running no compensations and settling
  nothing: the run is the new holder's now. `override deadline()` gives a run a
  wall-clock budget (`"45m"`, or milliseconds) that survives suspension; an
  abandoned run found past it is settled `failed` with its compensations instead
  of resumed. On a **shared** store, set `ZUKE_BUILD_ID` (or rely on
  `GITHUB_REPOSITORY`) so each build only recovers its own runs — a resume runs
  _this_ build's bodies against whatever record it is given, and a templated
  `build.ts` looks identical to the shape checks. Detail below.
- **Cross-run locks:** `.lock((s) => s.lockKey(...).withTtl("4h"))` — a settings
  lambda — gives a target an exclusive claim across runs/machines; a second run
  wanting the same key fails with a `LockConflictError` naming the holder, or
  queues when the target adds `.waitUpTo("30m")` (paced by `.pollEvery`). The
  lambda runs after params resolve, so the key can read `this.<param>.value`.
  The lock releases when the target settles and expires after the TTL if the
  holder is killed. Needs a state store (a build with `.lock()` enables the
  filesystem store by default). Add `s.holdForRun()` to hold the lock until the
  **run** settles instead — across a suspend at a gate and the resume — e.g. one
  rollout per service from deploy to promotion. Detail below.
- **External-event waits:** `.waitsFor((s) =>
  s.on(externalSignal("approved")).timeout("72h"))` makes a target a **gate**
  with no body: the run proceeds past it only when the trigger is satisfied,
  otherwise it **suspends** (state saved, exits 0) to be resumed later in a
  fresh process. Triggers: `externalSignal(name)` (payload read via
  `ctx.signals`) and `resumeWhen(predicate)`. Continue it with `zuke resume <id>
  --signal <name> [--data <json>]` (or `--check` for predicate waits/timeouts) —
  exactly-once, re-running only the not-yet-succeeded targets. Needs a state
  store. Detail below, or
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).
- **Wait on an external GitHub workflow (`@zuke/gh`):** in a `.waitsFor(...)`
  gate, `s.on(githubWorkflow((g) => g.repo("o/r").workflow("e2e.yml")))`
  dispatches a workflow in another repo and suspends until it finishes; read the
  per-job result with `readWorkflowResult(ctx.stateOf("<gate>"))`. Correlates by
  a `run-name:` marker by default, or `.correlate("created-window")` for a
  workflow you can't modify; fails fast (`.discoveryTimeout(...)`) if the run
  never correlates. The **dispatched** workflow has a contract: declare the
  marker input (`zuke_marker`, or rename via `.markerInput(...)`), echo it as
  its _entire_ `run-name:` (equality, not substring), and receive any of its
  `required: true` inputs via `.inputs(...)` — see the receiving-workflow
  contract below. Triggers are extensible — write your own against the exported
  `WaitTrigger`/`WaitContext`.
- **Cancellation & compensation:** `.onCancel(() => this.rollback)` registers a
  compensation that runs **iff this target succeeded** when the run is later
  cancelled — compensations run in reverse order, and the compensation body's
  `ctx.state` exposes the original target's persisted metadata (so a rollback
  reads what the deploy recorded). Cancel with `zuke cancel <id>` (or Ctrl-C, or
  the MCP `cancel_run` tool). Idempotent; a timed-out wait can route its
  `onTimeout` here (`"cancel-run"` or a named target), and so can a failed
  check: `.onFailure(() => "cancel-run")` turns that target's final failure into
  a cancellation, so a bad health check unwinds through the same rollback (a
  named target runs first, with the failed target's state). Needs a state store.
  See
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).
- **Durable side effects:** `.effect(name, fn)` records the intent to run `fn`
  before it runs, so a resume re-drives an effect a dead process left owed.
  Effects run after the body, in declaration order; a target may declare effects
  and no body. The guarantee is **at-least-once**, so write bodies that tolerate
  a repeat (an upsert, not an append), and read what the effect acts on from
  `ctx.state` rather than looking up "the current value" — a re-drive happens
  later, against a world that moved on. Needs a state store (enabled
  automatically). Detail below, or
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).

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
import { Build, HttpStateStore, target } from "@zuke/core";

class CD extends Build {
  override stateStore() {
    return new HttpStateStore({ url: this.url.value, token: this.token.value });
  }
  deploy = target().executes(async (ctx) => {
    // trySet resolves true when the patch reached the store, false when the
    // write was dropped. Check it before an irreversible step that needs it.
    if (!await ctx.state.trySet({ image: tag })) {
      throw new Error("not recorded");
    }
    const meta = ctx.state.get(); // read back (this run and later ones)
  });
}
```

- Backends: `FileSystemStateStore(dir)` (single host, dev) and `HttpStateStore({
  url, token? })` (hosted, production — see
  [`docs/state-api.md`](https://github.com/zuke-build/zuke/blob/master/docs/state-api.md)).
  Both dependency-free and pluggable behind `StateStore`. A hosted backend is
  verified with the **conformance kit** (`ZUKE_STATE_TOKEN=…
  ZUKE_REGISTRY_TOKEN=… deno run -A jsr:@zuke/core/conformance --url <base>`,
  the tokens optional and never a `--token` argument, which is refused; or
  `checkStateStore`/`checkBuildRegistry` from `@zuke/core/conformance`) — it
  exercises CAS, listing, and TTL-lock semantics. The HTTP clients stamp every
  request with `x-zuke-state-protocol: 1` and fail loudly on a server-declared
  mismatch.
- The run record holds status, the graph shape, resolved **non-secret**
  parameters, and per-target status/timing/metadata. Inspect it from the CLI
  with `zuke runs list [--status <s>] [--target <t>] [--since <iso>] [--limit
  <n>] [--counts]` (newest first) and `zuke runs show <id>` (`--json` on both),
  or programmatically with `store.listRuns({ status?, target?, since?, limit?
  })` and `store.getRun(id)`.
- **Retention:** `zuke runs prune --keep <age> --keep-last <n>` deletes only
  **terminal** runs matching neither rule (`--dry-run` to preview); a
  non-terminal run (suspended/running) is never pruned. The FS store owns
  pruning via the CLI; for the HTTP backend retention is the server's job (`GET
  /runs` takes `limit`; `DELETE /runs/:id` is optional). See
  [`docs/state.md`](https://github.com/zuke-build/zuke/blob/master/docs/state.md).
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
  class name, root target, graph) cannot separate one `build.ts` templated
  across a dozen services — same names, same graph, different bodies. So a run
  records an **origin** at creation: `ZUKE_BUILD_ID`, else `GITHUB_REPOSITORY`,
  else none. Every recovery path (`resume`, `resume --check`, `cancel`, the
  reaper) compares it; a sweep silently **skips** a foreign run (so a cron's
  exit code stays meaningful) and a by-name `resume <id>` / `cancel <id>`
  **reports** it. An origin only ever **narrows** what the shape checks permit —
  it can refuse a run, never claim one — so two builds in one repository, which
  share the repository default, stay separated by the build-name check exactly
  as before. An absent origin on either side abstains rather than refusing, so
  records written before the field existed stay recoverable — which means in a
  container you must set `ZUKE_BUILD_ID` yourself (there is no
  `GITHUB_REPOSITORY` in a CronJob), using the same value everywhere that build
  runs. Alternatively give each build its own URL prefix on the shared service
  (`ZUKE_STATE_URL=https://state/svc-a`) and neither can see the other's runs at
  all. See
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).
- **What a sweep counts as failed.** Not a race it lost: a run another process
  is already driving, one that process finished between the listing and the
  resume, and a run belonging to another build are all skipped and reported,
  never counted. A degraded record _is_ counted, on every sweep, because only an
  operator can decide whether its targets are safe to repeat.
- **Never put secrets in `ctx.state`** — it is stored as plain JSON. Secret
  parameters are excluded from the record and state values are run through the
  redactor, but treat state as a non-secret channel. See
  [`docs/state.md`](https://github.com/zuke-build/zuke/blob/master/docs/state.md).

## Cross-run locks

`.lock((s) => …)` takes a **settings lambda** (like the tool wrappers) and
claims an exclusive resource across runs and machines. A second run that wants
the same key **fails** with a `LockConflictError` (naming the holder) — it does
not queue.

```ts
import { Build, target } from "@zuke/core";

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
  machines. See
  [`docs/locks.md`](https://github.com/zuke-build/zuke/blob/master/docs/locks.md).
- `s.waitUpTo("30m")` queues for a held lock instead of failing at once, with
  `s.pollEvery("5s")` pacing the retries; the conflict is raised only once the
  wait is spent, and the run prints who holds the lock while it waits. This is a
  retry loop, not a queue: a waiter takes the lock on its next poll after it
  frees, racing every other waiter, so there is no arrival order. Reach for it
  on a shared resource a developer wants to use, not on one where a second run
  is a mistake worth reporting.
- `s.holdForRun()` keeps the lock past the target until the **run** settles —
  across a `waitsFor` suspend and resume. The token is recorded on the run
  record, renewed on a heartbeat while a process works on the run, renewed for a
  full TTL when the run parks, re-claimed on resume (a lapsed lock now held by
  another run refuses the resume and leaves the run suspended), and released on
  success, failure, `zuke cancel`, a gate timeout, or the reaper. Set the TTL to
  cover the longest park. A later target declaring the same key while the run
  holds it is a no-op.

## External-event waits

`.waitsFor((s) => …)` makes a target a **gate** (no body): the run proceeds past
it only when the trigger is satisfied; otherwise it **suspends** — the run's
state is saved, independent branches finish, and the process exits 0 — to be
resumed later in a fresh process.

```ts
import { Build, externalSignal, target } from "@zuke/core";

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
  you can't modify use `.correlate("created-window")` (best-effort). A marker is
  copyable and anyone who can dispatch the workflow can wear it, so a run is
  adopted only if it is _also_ a `workflow_dispatch`, on the dispatched ref, and
  created within the discovery window; two survivors are a refusal, and the
  identity is re-checked before the result is read. A holder of `actions: write`
  on that repo can still dispatch the same workflow (branch protection does not
  gate a dispatch), so narrow that permission or use an environment with
  required reviewers when the gate authorizes work in another trust domain.
  Either way it **fails fast** (`.discoveryTimeout(...)`, default 1m) if the run
  never correlates, instead of eating the whole `.timeout()`. The **dispatched**
  workflow has its own contract (marker input, run-name, required inputs) — see
  [The dispatched workflow's contract](#the-dispatched-workflows-contract-githubworkflow)
  below. Write your own trigger against the exported `WaitTrigger` /
  `WaitContext` interface.
- Needs a state store (a build with `.waitsFor()` enables `.zuke/runs` by
  default). A resume is a fresh process, so **only `ctx.state`/`ctx.signals`
  cross the boundary**. See
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).
- Continue a suspended run with `zuke resume <id> --signal <name> [--data
  <json>]` (or `zuke resume --check [<id>]` for predicate waits/timeouts).
  Resumption is **exactly-once** (concurrent resumers get `AlreadyResumedError`)
  and re-runs only the not-yet-succeeded targets; `--force-graph` overrides a
  changed graph.

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
  **exactly, not by substring**. A decorated run-name (`run-name: E2E [${{
  inputs.zuke_marker }}]`) dispatches fine but never correlates — the gate just
  times out. Echo the marker as the workflow's _entire_ `run-name:`, or use
  `.correlate("created-window")`.

## Cancellation & compensation — `.onCancel()`

Undo a target's effect when the run is cancelled. `.onCancel(target | () =>
target)` registers a **compensation** that runs **iff this target succeeded**;
on cancel, compensations run in **reverse order** of the succeeded targets.

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
  the work). `ctx.state` is seeded with the meta of the target the step is
  **for**: under `.onCancel` that is the compensated target (so `ctx.target`
  names the compensation but `ctx.state` holds `deploy`'s meta), while a
  timed-out `.onTimeout(() => this.cleanup)` makes `cleanup` compensate
  **itself** — its own meta, `{}` if it never ran forward. One rule spans both:
  `ctx.stateOf(ctx.target)` is `ctx.state`, every other name reads **empty** (so
  `stateOf("deploy")` is empty under `.onCancel`). Writes stay in memory.
  `ctx.outcomeOf(...)` works; `ctx.plan()` is the whole run's plan, so a
  compensation is in it only when it is also a graph target.
- Cancel with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, or the MCP `cancel_run`
  tool (all run the same walk). A live run aborts on its next state write.
- A compensation that throws is recorded but does **not** stop the walk (cleanup
  is maximal). Cancelling a finished run is a friendly no-op.
- A failed target can route here too: `.onFailure(() => "cancel-run")` makes its
  **final** failure (after `.retry`/`.recoverWith`) cancel the run, so a failed
  health check unwinds through the same compensations as `zuke cancel`.
  `.onFailure(() => this.diagnose)` runs that target first, with the **failed
  target's** meta in `ctx.state` — an **extra** step before the walk, so name a
  cleanup for the failed target itself (which the walk never compensates), never
  a predecessor's rollback (it would run twice). The result keeps the error with
  `cancelled: true`; a dry run never cancels; not allowed on a `.forEach()`
  stage (put it on the fan-out target). Evaluated once up front: a throwing or
  self-naming thunk, a non-target, or pairing it with `.proceedAfterFailure()`
  refuses the run.
- A timed-out `.waitsFor()` can route here: `.onTimeout(() => "cancel-run")`
  cancels the run (running compensations); `.onTimeout(() => this.cleanup)` runs
  that target too. Needs a state store (a build with `.onCancel()` enables
  `.zuke/runs` by default). See
  [`docs/orchestration.md`](https://github.com/zuke-build/zuke/blob/master/docs/orchestration.md).

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
