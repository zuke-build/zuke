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
        .onTimeout(() => this.rollback));

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
- **`s.timeout("72h")`** — an optional deadline. Its purpose and enforcement
  (running `onTimeout`) arrive with the resume half.
- **`s.onTimeout(() => this.rollback)`** — what a timed-out wait does: a **thunk**
  returning a sibling compensation target, or `"fail"` / `"cancel-run"`. A thunk
  because the compensation is usually declared *below* the waiting target, and
  fields initialise top-to-bottom.

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
   wins**. A loser gets a clean `AlreadyResumedError` (`run X was already
   resumed by …`) and exits non-zero — safe to run the same resume from a
   retrying cron.
2. **Re-instantiates the build**, re-resolves parameters from the record (CLI
   may override non-secret ones; secrets re-resolve from the environment), and
   **verifies the graph still matches** the suspended run — a changed graph
   (added/removed/re-wired targets) is a hard error unless you pass
   `--force-graph`.
3. **Re-runs only what hadn't succeeded.** Targets recorded `succeeded` are
   seeded as done and skipped; the wait re-evaluates its trigger (now
   satisfied) and the run continues — possibly suspending again at a later wait.

Programmatically, `resumeRun(build, { runId, signal, data })` and
`resumeCheck(build, { runId? })` do the same.

### Timeouts

A wait past its `timeout` deadline **times out** instead of resuming: the target
is failed and the run fails, its recorded `onTimeout` disposition preserved.
Running a compensation target on timeout (rather than just failing) arrives with
the cancellation milestone.

## State is the only thing that crosses the boundary

A resume is a **fresh process**: the in-memory world of the suspending run is
gone. Anything a later target needs must be in the durable record —
`ctx.state` (per-target metadata) and `ctx.signals` (delivered payloads). This
is the mental model to build around: persist what matters, read it back on the
other side.

See [Durable run state](./state.md) for the record shape and `ctx.state`.
