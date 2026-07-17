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
| `dryRun`     | `boolean`           | `true` when the run is a dry run (bodies don't execute in a dry run). |

`runId` is minted once per run (`crypto.randomUUID()`), so it correlates every
target, the run record ([Durable run state](./state.md)), and — in later
milestones — spans and resumptions.

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
completion; Zuke does not forcibly interrupt arbitrary JavaScript. Turning
cancellation into a first-class graph operation — compensations that run in
reverse order, `zuke cancel <run-id>`, `Ctrl-C` — is a later milestone.

### Scope of the ambient signal

The ambient signal is scoped to the run's async context (via
`AsyncLocalStorage`), so concurrent in-process runs each see their own signal
and none leaks past the run that set it.
