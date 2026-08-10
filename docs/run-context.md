# Run context & cancellation

Every target body may receive a **`TargetContext`** — a small, typed handle to
the run it is part of. It is entirely optional: an existing zero-argument body
keeps working unchanged, because a `() => …` function is assignable to the
one-parameter body type.

```ts
import { Build, target } from "jsr:@zuke/core";

class Deploy extends Build {
  ship = target().executes(async (ctx) => {
    console.log(`run ${ctx.runId} · target ${ctx.target}`);
    // ctx.signal, ctx.state, ctx.dryRun are here too — see below.
  });
}
```

## What's on the context

| Field        | Type                | What it is                                                            |
| ------------ | ------------------- | -------------------------------------------------------------------- |
| `runId`      | `string`            | Unique id of this run, **stable for every target** in the run.       |
| `target`     | `string`            | The executing target's dotted name.                                  |
| `signal`     | `AbortSignal`       | Aborted when the run is cancelled (see below).                       |
| `state`      | `TargetStateHandle` | Durable per-target metadata — see [Durable run state](./state.md).   |
| `stateOf`    | `(t) => …`          | The state handle of **another** target — read a dependency's published metadata (e.g. a wait's result). |
| `outcomeOf`  | `(t) => …`          | What another target in this run **did** — `succeeded`, `failed`, `skipped`, … or `undefined` if it has none yet. |
| `outcomes`   | `() => ReadonlyMap` | Every outcome settled so far, keyed by target name. |
| `signals`    | `ReadonlyMap`       | Payloads of external signals received so far (see [waits](./orchestration.md)). |
| `dryRun`     | `boolean`           | `true` when the run is a dry run (bodies don't execute in a dry run). |

`runId` is minted once per run (`crypto.randomUUID()`), so it correlates every
target, the run record ([Durable run state](./state.md)), a resumed run's
spans ([Observability](./observability.md)), and a
[resumption](./orchestration.md) of a suspended run.

## Reading what the rest of the run did

`ctx.outcomeOf(name)` reports another target's status in this run, and
`ctx.outcomes()` returns all of them. The status is the **run record's**
vocabulary — `succeeded`, `failed`, `skipped`, `waiting`, `running` — so a
target whose body ran and one served from the incremental cache both read
`succeeded`, which is the distinction the record keeps.

<!-- check -->

```ts
import { Build, target } from "jsr:@zuke/core";

class Ci extends Build {
  unit = target().executes(() => {});
  docs = target().onlyWhen(() => false).executes(() => {});
  report = target().dependsOn(this.unit, this.docs).executes((ctx) => {
    const skipped = [...ctx.outcomes()]
      .filter(([, outcome]) => outcome.status === "skipped")
      .map(([name]) => name);
    console.log(`skipped: ${skipped.join(", ")}`);
    console.log(`unit: ${ctx.outcomeOf("unit")?.status}`);
  });
}
```

- **A target that has not settled has no outcome** — `undefined` rather than a
  placeholder. That includes the target doing the asking, and any sibling still
  running concurrently. Depend on what you intend to read.
- **Outcomes survive a resume.** After a suspend, the process that resumes never
  re-runs what already succeeded, and still reports it — those come from the
  durable [run record](./state.md).
- **A store is not required.** A run with no state store answers the same way
  for everything settled in that process.

## Crash-durable effects — `.effect()`

A target body that dies halfway leaves no trace of what it was doing. For work
where that matters — posting a required status check, publishing a release,
telling another system something finished — declare it as an **effect**. The
intent to run it is written to the [run record](./state.md) and confirmed
*before* the body runs, so a process killed anywhere inside it leaves evidence
that the effect was owed, and a resume drives it again.

<!-- check -->

```ts
import { Build, target } from "jsr:@zuke/core";

class Ci extends Build {
  checks = target().proceedAfterFailure().executes(() => {});
  gate = target().dependsOn(this.checks).always()
    .effect("post-gate", async (ctx) => {
      const failed = [...ctx.outcomes()].some(([, o]) => o.status === "failed");
      await postVerdict(failed ? "failure" : "success", ctx.redriven);
    });
}

declare function postVerdict(
  conclusion: string,
  redriven: boolean,
): Promise<void>;
```

- **At-least-once, not exactly-once.** A process that dies *after* the side
  effect but before recording it will repeat the effect. Write bodies that
  tolerate it — because repeating is harmless, or because the far side converges
  (an upsert rather than an append). `ctx.redriven` is `true` when a previous
  attempt already committed its intent.
- **A completed effect is skipped, not repeated.** Once recorded `done`,
  re-driving the target is free.
- **What re-drives it, precisely.** A resume acts on a run recorded
  `suspended`, so an effect owed by a run that suspended at a wait is driven
  again by the ordinary `zuke resume` / `zuke resume --check`. A process that was
  *killed* leaves its run `running`, and a run in that state is not resumable
  until something moves it back to `suspended` — so an effect owed by a killed
  process waits for a reaping sweep or an operator. The intent itself is durable
  either way; what differs is what comes along to act on it.
- **Pin what the effect acts on.** Read it from `ctx.state` /
  `ctx.stateOf(...)`, which is replayed from the record and cannot be overridden
  from outside. A parameter is nearly as good: the record seeds a resume, so one
  nobody re-supplies keeps its original value — but a resume that passes it
  explicitly wins, which is how a secret gets re-supplied. For a value that must
  not drift, use state.
- **A store is required**, and enabled automatically. With state explicitly
  disabled the run is refused rather than performing an effect nothing recorded
  as owed.
- **Effects run after the body**, in declaration order, and are repeatable. A
  target may declare effects and no body.
- **An intent that cannot be recorded fails the target**, with the body never
  having run. No durable intent, no side effect.

## Cancellation

A run can be cancelled by passing an `AbortSignal` to `execute`
([programmatic API](./programmatic-api.md)):

```ts
import { execute } from "jsr:@zuke/core";

const controller = new AbortController();
const result = execute(build, build.deploy, { signal: controller.signal });
// …later, from elsewhere:
controller.abort();
await result;
```

When the signal aborts:

- **`ctx.signal` fires** for every in-flight target, so a body that watches it
  can wind down cleanly.
- **In-flight shell commands are terminated.** The run's signal is installed as
  the shell's _ambient_ signal, so a plain `` $`…` `` in a target body is sent
  `SIGTERM` on cancellation — no need to thread the signal through by hand:

  ```ts
  ship = target().executes(async () => {
    await $`terraform apply`; // killed with SIGTERM if the run is cancelled
  });
  ```

  To cancel a command explicitly (or to override the ambient signal), use
  `.signal(...)`:

  ```ts
  await $`long-running`.signal(ctx.signal);
  ```

  `.signal()` composes with [`.killAfter()`](./shell.md): whichever fires first
  — the timeout or the cancellation — terminates the process.

A body that ignores its signal and never touches the shell still runs to
completion; Zuke does not forcibly interrupt arbitrary JavaScript. Cancellation
is also a first-class **graph operation**: `zuke cancel <run-id>` (or `Ctrl-C`)
unwinds every succeeded target's declared `.onCancel(...)` compensation in
reverse order — see [Orchestration](./orchestration.md#cancellation--compensation--oncancel).

### Scope of the ambient signal

The ambient signal is scoped to the run's async context (via
`AsyncLocalStorage`), so concurrent in-process runs each see their own signal
and none leaks past the run that set it.
