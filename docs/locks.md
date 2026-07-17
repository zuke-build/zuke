# Cross-run locks

A **lock** lets a target claim an exclusive resource across runs and processes —
"only one deploy of repo X at a time", "one migration at a time". It builds on
[durable run state](./state.md): the lock lives in the same store, so it holds
across separate `zuke` invocations, separate machines (with the HTTP backend),
and process restarts.

```ts
import { Build, target } from "jsr:@zuke/core";

class CD extends Build {
  repo = parameter("service to deploy");

  promote = target()
    .lock((s) =>
      s.lockKey("deploy", this.repo.value)
        .withTtl("4h")
        .onConflict((holder) =>
          `${this.repo.value} is being deployed by ${holder.actor} ` +
          `(run ${holder.runId}, since ${holder.since}). Wait, then retry.`))
    .executes(async (ctx) => {/* … */});
}
```

`.lock()` takes a **settings lambda** (the same style as the tool wrappers): `s`
collects the key, TTL, and conflict message fluently. The lambda runs after
parameters resolve, so the key can read `this.<param>.value`.

## Semantics

- **Exclusive.** While a run holds the lock for a `key`, any other run that
  tries to acquire the same key **fails** with a `LockConflictError` — it does
  not queue or block. The error's message is the rendered guidance and its
  `holder` carries the structured identity (`actor`, `runId`, `since`,
  `runUrl?`).
- **The key** is set with `s.lockKey(...parts)` (sanitised and joined, safe as a
  filename and URL segment) or `s.key(literal)`. Because the whole settings
  lambda runs after parameters resolve, a key built from `this.repo.value` sees
  the final value.
- **TTL.** `s.withTtl(...)` (a duration like `"4h"`, `"30m"`, or milliseconds) bounds how
  long the lock survives **if the holder disappears**. A live holder renews it
  automatically at half the TTL while its body runs, so a long deploy under a
  short TTL never loses its lock. If the holding process is `kill -9`'d, the
  renewals stop and the lock becomes free once the TTL passes — no manual
  cleanup, no wedged pipeline.
- **Release.** The lock is released when the target settles — **success,
  failure, or cancellation** — in a `finally`, so the common path never relies
  on the TTL. The TTL is only the backstop for a killed process.

## Conflicts

The loser of a conflict gets actionable guidance, on every surface:

- **CLI:** the run exits non-zero and the failure footer prints the guidance.
- **Programmatic / MCP (later):** the thrown `LockConflictError` carries
  `holder`, so a caller can relay who holds it and for how long.
- **Run record:** the target is recorded `failed` with the guidance as its
  error.

Provide `s.onConflict(holder => …)` to phrase the guidance for your domain; omit
it for a sensible default that names the holder and its run.

## Requires a state store

A lock needs somewhere durable to live, so a build that uses `.lock()` turns on
the [filesystem state store](./state.md) (`.zuke/runs`) **by default** — no
`--state` needed. Point it at the [HTTP backend](./state-api.md) (via
`ZUKE_STATE_URL` or `stateStore()`) to share locks across machines; the server
is authoritative for expiry, which side-steps client clock skew. A build that
declares `.lock()` with state explicitly disabled fails with a friendly error.

## Concurrency guarantee

Acquisition is atomic. Two runs racing for the same free key → **exactly one**
acquires; the other gets the conflict. An expired lock is taken over atomically.
The filesystem backend is single-host (an `O_EXCL` marker serialises
acquisition); the HTTP backend uses the same optimistic model across hosts.
