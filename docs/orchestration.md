# Orchestration: waits & suspend/resume

A deployment pipeline often has to **pause for something outside the build** —
manual QA sign-off, a soak period, another system's callback — and continue
later, possibly days later and in a different process. Zuke models this as a
**wait**: a target suspends the run until an external event occurs; the run's
state is saved to the [state store](./state.md), and it is resumed when the
event happens.

The lifecycle has two halves: a run **suspends** at a wait, and is later
**resumed** — see [Resuming a suspended run](#resuming-a-suspended-run) below.

## Declaring a wait — `.waitsFor()`

`.waitsFor()` makes a target a **gate**: it has no body, and the run proceeds
past it only once its trigger is satisfied.

```ts
import { Build, externalSignal, target } from "jsr:@zuke/core";

class Deploy extends Build {
  deployToSit = target().executes(async (ctx) => {
    await applyToSit();
    await ctx.state.set({ at: "sit-7" }); // survives the suspend (see below)
  });

  awaitTesting = target()
    .dependsOn(this.deployToSit)
    .waitsFor((s) =>
      s.on(externalSignal("testing-approved"))
        .timeout("72h")
        .onTimeout(() => this.rollback)
    );

  promoteToProd = target()
    .dependsOn(this.awaitTesting)
    .executes((ctx) => {
      const approval = ctx.signals.get("testing-approved"); // the signal payload
      promote(approval?.data);
    });

  rollback = target().executes(() => rollBackSit());
}
```

`.waitsFor((s) => …)` is a fluent settings lambda ([like the rest](./locks.md)):

- **`s.on(trigger)`** — the event to wait for. Two triggers ship:
  - **`externalSignal(name)`** — satisfied when a signal named `name` is
    delivered to the run. Its JSON payload is exposed to later target bodies
    through `ctx.signals`.
  - **`resumeWhen(fn, { interval? })`** — satisfied when an async predicate
    returns `true`. Zuke doesn't poll on its own; the predicate is re-checked on
    each resume, so a cron or webhook drives it.
  - **`githubWorkflow((g) => …)`** — dispatches a GitHub Actions workflow (often
    in another repo) and is satisfied when it finishes; see
    [below](#waiting-for-an-external-github-workflow). A third-party trigger from
    [`@zuke/gh`](../packages/gh/README.md), built on the exported `WaitTrigger` /
    `WaitContext` seam — you can write your own the same way.
- **`s.timeout("72h")`** — an optional deadline. Its purpose and enforcement
  (running `onTimeout`) arrive with the resume half.
- **`s.onTimeout(() => this.rollback)`** — what a timed-out wait does: a
  **thunk** returning a sibling compensation target, or `"fail"` /
  `"cancel-run"`. A thunk because the compensation is usually declared _below_
  the waiting target, and fields initialise top-to-bottom.

### Waiting for an external GitHub workflow

[`@zuke/gh`](../packages/gh/README.md)'s `githubWorkflow` trigger dispatches a
GitHub Actions workflow and suspends until it finishes — replacing hand-rolled
"dispatch, then poll `gh run list`" glue:

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { githubWorkflow, readWorkflowResult } from "jsr:@zuke/gh";

class Release extends Build {
  e2e = target().waitsFor((s) =>
    s.on(githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml").ref("main")))
      .timeout("2h").onTimeout(() => this.rollback)
  );
  ship = target().dependsOn(this.e2e).executes((ctx) => {
    // The gate publishes its result to its own state — read it via stateOf.
    const result = readWorkflowResult(ctx.stateOf("e2e"));
    if (!result?.passed) throw new Error("e2e suite failed");
  });
  rollback = target().executes(() => rollBack());
}
```

- **Dispatch-once, then poll.** On first reach it dispatches, records a
  correlation marker in the gate's durable state, and suspends. Each
  `resume --check` polls the run; a resume in a **different process** never
  re-dispatches, because the marker persisted with the run.
- **Correlation.** `workflow_dispatch` returns no run id, so the trigger passes a
  marker input (default `zuke_marker`) and matches it against the run's display
  title — the dispatched workflow must echo it into `run-name`:
  `run-name: ${{ inputs.zuke_marker }}`.
- **Result.** On completion the per-job conclusions (`{ passed, jobs: [{ name,
  conclusion, url }] }`) are written to the gate target's state; a dependent
  reads them with `readWorkflowResult(ctx.stateOf("<gate>"))` and branches on a
  failed suite.
- **Auth** uses `GH_TOKEN` / `GITHUB_TOKEN`; the GitHub API is an injectable
  transport, so it is testable without a real GitHub.

## What suspend does

When the scheduler reaches a wait whose trigger is **not** satisfied:

1. The target is recorded **`waiting`**, with its `waitingFor` (the trigger, the
   deadline, and the timeout disposition).
2. The run is recorded **`suspended`**.
3. Targets **behind** the wait stay `pending` (a resume will run them);
   **independent** branches run to completion.
4. The process prints where the run was saved and **exits 0** — a suspended run
   has not failed.

A satisfied trigger, by contrast, passes straight through: the gate is
`succeeded` and its dependents run in the same process.

Because a wait must be resumable, **it requires a state store** — a build that
uses `.waitsFor()` turns on the `.zuke/runs` filesystem store by default (like
locks). Declaring a wait with state disabled fails with a friendly error.

## Resuming a suspended run

Deliver the awaited event with `zuke resume`:

```sh
# Satisfy an externalSignal wait, with an optional JSON payload:
zuke resume <run-id> --signal testing-approved --data '{"by":"qa"}'

# Re-check predicate (resumeWhen) waits and enforce timeouts — the cron/webhook
# entry point; sweeps every suspended run when no id is given:
zuke resume --check [<run-id>]
```

Resuming:

1. **Delivers the signal** (if any) into the record and transitions the run
   `suspended → running` with a **compare-and-swap, so exactly one resumer
   wins**. A loser gets a clean `AlreadyResumedError`
   (`run X was already
   resumed by …`) and exits non-zero — safe to run the
   same resume from a retrying cron.
2. **Re-instantiates the build**, re-resolves parameters from the record (CLI
   may override non-secret ones; secrets re-resolve from the environment), and
   **verifies the graph still matches** the suspended run — a changed graph
   (added/removed/re-wired targets) is a hard error unless you pass
   `--force-graph`.
3. **Re-runs only what hadn't succeeded.** Targets recorded `succeeded` are
   seeded as done and skipped; the wait re-evaluates its trigger (now satisfied)
   and the run continues — possibly suspending again at a later wait.

Programmatically, `resumeRun(build, { runId, signal, data })` and
`resumeCheck(build, { runId? })` do the same.

### Timeouts

A wait past its `timeout` deadline **times out** instead of resuming, honouring
its recorded `onTimeout` disposition:

- **`"fail"`** (the default) — the waiting target is failed and the run fails.
- **`"cancel-run"`** — the run is **cancelled**: every succeeded target's
  compensation runs (see [Cancellation](#cancellation--compensation-oncancel))
  and the record settles `cancelled`. This is what unwinds a stuck deploy → wait
  and releases its locks, rather than leaving them held until their TTL.
- **a sibling target** (`.onTimeout(() => this.rollback)`) — that specific
  target runs as a compensation, then the run is cancelled (running the rest of
  the compensations too).

Timeouts are enforced lazily on any `zuke resume`/`resume --check`, so a single
cron that sweeps suspended runs also enforces every deadline.

## State is the only thing that crosses the boundary

A resume is a **fresh process**: the in-memory world of the suspending run is
gone. Anything a later target needs must be in the durable record — `ctx.state`
(per-target metadata) and `ctx.signals` (delivered payloads). This is the mental
model to build around: persist what matters, read it back on the other side.

See [Durable run state](./state.md) for the record shape and `ctx.state`.

## Cancellation & compensation — `.onCancel()`

Cancelling a run should be **safe and complete**: work that already happened is
undone, locks are released, and the record ends `cancelled`. Zuke does this with
**compensation targets** — the inverse of a target, declared with `.onCancel()`.

```ts
class CD extends Build {
  deploy = target()
    .executes((ctx) => ctx.state.set({ slot: "sit-7" })) // record what it did
    .onCancel(() => this.rollback); // …and how to undo it
  rollback = target().executes((ctx) => tearDown(ctx.state.get().slot));

  gate = target().dependsOn(this.deploy)
    .waitsFor((s) => s.on(externalSignal("approved")));
  promote = target().dependsOn(this.gate).executes(() => {});
}
```

Cancel it three ways — all run the same walk:

```bash
zuke cancel <run-id>     # cancel a persisted run (any process)
# Ctrl-C / SIGTERM       # cancel the run in this process
# MCP cancel_run tool    # cancel over MCP (gated like a run tool)
```

What a cancellation does:

- **A compensation runs iff its target succeeded.** A target that never ran, was
  skipped, or failed has nothing to undo. Compensations run in **reverse order**
  of the targets that succeeded, so later work is unwound before the work it was
  built on.
- **Each compensation reads its target's persisted state.** The compensation
  body gets a normal `ctx` whose `ctx.state` exposes **the original target's**
  metadata — the `deploy` above rolls back from exactly the `slot` it recorded.
  So persist what a rollback needs in `ctx.state` at the time you do the work.
- **A live run stops.** Cancelling a run another process is executing flips it
  to `cancelling`; the owner observes that on its next state write and aborts —
  its in-flight `$` commands get SIGTERM through the ambient signal, releasing
  the locks they held. (A body that ignores its `ctx.signal` runs to completion,
  so pass `ctx.signal` to long shell commands.)
- **Cleanup is maximal.** A compensation that throws is recorded but does
  **not** stop the walk — every other compensation still runs. The failures are
  reported and land in the run's audit trail.
- **It is idempotent.** Cancelling an already-finished (or already-cancelled)
  run is a friendly no-op — safe to run from a retrying operator or a double
  Ctrl-C.

The compensation is a **thunk** (`() => this.rollback`) so it can reference a
target declared _below_ the one it cleans up (class fields initialise
top-to-bottom, exactly like `waitsFor`'s `onTimeout`). The whole cancellation is
recorded as a `cancel` event in the run's [audit trail](./state.md), attributed
to whoever cancelled it, so `zuke runs show <id>` shows what was unwound.

Cancellation needs a state store, so a build that uses `.onCancel()` turns on
the `.zuke/runs` filesystem store by default (like `.lock()` and `.waitsFor()`).

> **Limitation:** the cancel walk considers only the static plan, so an
> `.onCancel()` on a [`.forEach()`](#fan-out-over-a-list--foreach)
> **sub-target** is not run (sub-targets are materialised at run time and don't
> exist at cancel time). Put a compensation on an ordinary target, or on the
> parent fan-out target itself.

## Fan-out over a list — `.forEach()`

`.forEach()` runs the **same pipeline over a runtime list** — deploy N repos,
migrate N tenants — with per-item failure isolation and bounded concurrency,
without hand-writing a target per item.

```ts
class CD extends Build {
  repos = parameter("services to deploy").array().required();

  deployBatch = target().forEach(
    () => this.repos.value, // items: a thunk, read when the target runs
    (repo) => ({ // factory: an ordered pipeline of sub-targets per item
      checks: target().executes(() => checkDeployable(repo)),
      fork: target().executes(() => forkImage(repo)),
      deploy: target().executes((ctx) => applyToSit(repo, ctx)),
    }),
    (s) => s.concurrency(3).continueOnItemFailure(),
  );
}
```

- **`items`** is a thunk, evaluated when the target runs, so it can read
  `this.<param>.value` (parameters resolve first). Its element type is inferred
  and flows into the factory.
- **`factory`** returns an ordered record of sub-targets for one item. Each
  stage implicitly depends on the one declared before it, so an item's stages
  run **in order** (`checks` → `fork` → `deploy`). Each is a full target — it
  can use `ctx`, `ctx.state`, `.timeout()`, `.retry()`, and the rest.
- **Execution is the pipeline model:** items run **concurrently** (up to
  `concurrency`, default the CPU count), each item's stages **sequentially**.
  There is no barrier between items — a fast item finishes while a slow one is
  still on its first stage.
- **`continueOnItemFailure()`** isolates a failure: one item's failed stage
  skips that item's later stages but lets the other items finish. Without it,
  the first failure stops the batch. Either way, the fan-out target **fails if
  any item failed** (unless you also mark it `.proceedAfterFailure()`).

Sub-targets are materialised at run time, named `deployBatch[<item>].<stage>`,
and are **first-class**: each gets its own row in the summary and its own entry
in the [run record](./state.md) (so `zuke runs show` reports per-item verdicts).
The item key is a scalar item's own value (else its index), so it becomes part
of the target name in output and the record — **fan out over non-secret
identifiers** (repo names, tenant ids), never over `.secret()` values, which are
meant for parameters (they are excluded from the record) rather than as loop
keys. Static views — `zuke --list`, `zuke graph` — show only the one fan-out
node (annotated `[fan-out]`), since the sub-targets exist only while the build
runs.

Runtime lists pair naturally with [array parameters](./parameters.md#lists):
`.options("api", "web").array()` validates each element, and `.number().array()`
yields a `number[]` — so the batch's inputs are typed and checked before it
runs.
