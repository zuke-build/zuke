# Run context & cancellation

Every target body may receive a **`TargetContext`** — a small, typed handle to
the run it is part of. It is entirely optional: an existing zero-argument body
keeps working unchanged, because a `() => …` function is assignable to the
one-parameter body type.

<!-- check -->

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
| `reportSummary` | `(pairs) => void` | Put `key: value` notes on **this target's row** of the Build Summary — see [Notes on the summary row](#notes-on-the-summary-row). |

`runId` is minted once per run (`crypto.randomUUID()`), so it correlates every
target, the run record ([Durable run state](./state.md)), a resumed run's
spans ([Observability](./observability.md)), and a
[resumption](./orchestration.md) of a suspended run.

## Notes on the summary row

The end-of-build summary says what each target did in one word — `Succeeded`,
`Failed` — and how long it took. `ctx.reportSummary({ … })` adds the numbers
that word hides, trailing the row NUKE-style:

```text
Target      Status       Duration
──────────────────────────────────
restore     Succeeded        4.0s
test        Succeeded        8.1s  // Tests: 837 · Passed: 837 · Failed: 0
pack        Succeeded        0.3s  // Packages: 1
```

<!-- check -->

```ts
import { Build, target } from "jsr:@zuke/core";

class CI extends Build {
  pack = target().executes((ctx) => {
    const packages = ["@zuke/core", "@zuke/deno"];
    // …pack each one…
    ctx.reportSummary({ Packages: packages.length, Version: "3.6.2" });
  });
}
```

A wrapper that knows what its tool printed reports for you. `DenoTasks.test`
puts `// Tests: 837 · Passed: 837 · Failed: 0` on the row of whichever target
ran it:

<!-- check -->

```ts
import { Build, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class Checks extends Build {
  test = target().executes(async (ctx) => {
    await DenoTasks.test((s) => s.allowAll()); // reports the counts itself
    ctx.reportSummary({ Version: "3.6.2" }); // the body adds what it knows
  });
}
```

Notes accumulate across calls in one target, and reporting a key again
replaces its value in place. Each key and value renders on a single line
(whitespace collapsed, colour codes removed) in both the terminal table and the
GitHub Actions job summary, where they form a `Notes` column. A failed target
keeps the notes it reported before failing, so a red `test` row still says how
many tests failed.

Library code that has no `ctx` in hand — a tool wrapper, or a helper a body
calls — reports through the **ambient** form, `reportSummary(pairs)` from
`@zuke/core`. It lands on the row of whichever target is running, scoped like
the [ambient signal](#scope-of-the-ambient-signal) to that target's async
subtree, so concurrent targets never mix notes. Outside a running target it is
a no-op: a wrapper never has to ask where it runs. This is the seam a tool
wrapper reports through, so a body only adds what its tools do not:
`DenoTasks.test` reports Tests, Passed, Failed (and Ignored when non-zero)
from deno's own result line — on a failed run too, so a red row says how many
failed — and `DenoTasks.coverage` reports the measured line and branch
percentages.

Test runners share one shape. `reportTestCounts({ passed, failed, skipped?,
todo?, flaky? })` from `@zuke/core` reports `Tests` (the sum), `Passed` and
`Failed`, then `Skipped`, `Todo` and `Flaky` only when non-zero, so every
test-runner wrapper puts the same labels on its row and a body that runs tests
some other way can match them.

### What the wrappers report

| Wrapper | Notes on the row |
| --- | --- |
| `DenoTasks.test` | `Tests`, `Passed`, `Failed`, and `Ignored` when non-zero |
| `DenoTasks.coverage` | `Lines`, and `Branches` when any were measured |
| `DenoTasks.lint` | `Files`, `Problems` |
| `DenoTasks.fmt` | `Files`, and `Unformatted` under `.check()` |
| `DenoTasks.check` | `Errors` |
| `EslintTasks.lint` | `Problems`, `Errors`, `Warnings` |
| `OxlintTasks.lint` | `Errors`, `Warnings`, and `Files` when the timing line names them |
| `BiomeTasks.check` / `lint` / `format` / `ci` | `Files`, `Errors`, `Warnings` |
| `TscTasks.tsc` / `build` | `Errors` |
| `CspellTasks.lint` | `Files`, `Issues` |
| `DprintTasks.check` | `Unformatted` |
| `DprintTasks.fmt` | `Formatted` |

Each is read from the closing line the tool itself prints, on a failed run
too, so a red row says how many. A clean run reports its zeros — a green
`lint` row that says `Problems: 0` is the point. A run that exited non-zero
without printing its closing line (a bad flag, a missing config) reports
nothing rather than a misleading zero. A machine-readable reporter that
replaces the closing line (`--format json`, JUnit) reports nothing either.

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
