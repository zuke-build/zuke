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

## The run's own lease

Separately from any lock a target declares, a run with a
[state store](./state.md) holds a **lease** on itself for as long as it is
running: `zuke-run-<run-id>`, taken before the record is written `running` and
released when the run settles. It is renewed by a background heartbeat at half
its 60-second TTL.

Its whole job is to make "slow" and "dead" different things. A run record cannot
tell them apart on its own — a process mid-step and a process that was
`SIGKILL`ed both leave a record that says `running` and stops changing. The lease
answers it: a live holder keeps renewing, so a claim that has lapsed means the
holder is gone and the run can be taken over.

- **Ordering matters.** The lease is taken *before* the record says `running`,
  and on a resume before the record leaves `suspended` — so a `running` record
  always has a live holder. Acquiring afterwards would leave a window in which a
  perfectly healthy run looked abandoned.
- **A resume refuses a run whose holder has not let go.** Two processes working
  one run is worse than a delayed resume, so the claim is checked before the
  compare-and-swap and a resumer that cannot take it stops.
- **Losing it stops the run — it does not cancel it.** If a renewal is refused —
  the claim is demonstrably somebody else's now — the run stops rather than
  carrying on beside whoever took it over. Stopping is *all* it does: it does
  **not** run the compensations, and it does **not** settle the record. Both
  belong to the new holder now, and unwinding work that holder is already
  building on would be the very "two processes on one run" the lease exists to
  prevent. Per-target progress already queued is dropped rather than flushed —
  the writer stops writing the moment the claim is lost, so nothing it had left
  to say lands on the new holder's record — nothing new is started, and the
  process reports that the run was taken over. A claim lost *during* a
  cancellation's rollback stops that walk where it stands, for the same reason:
  the remaining compensations belong to whoever holds the run now.
- **A refused renewal is loss; a failed one is not.** A store answers "no" when
  the claim has changed hands, but it *throws* for a filesystem mutex it could
  not take in time, or an HTTP 503, or a DNS blip. None of those say who holds
  the lease, so they are retried on the next tick rather than aborting a healthy
  build over a bad second.
- **The heartbeat never keeps a process alive** — and, like any timer, it does
  not fire while the event loop is blocked in synchronous work. A run that blocks for longer than the TTL can therefore have
  its lease lapse and be taken over; losing the claim then stops it, so the
  outcome is a stopped run rather than two writers.
- **Whoever takes the claim gives it back.** A resume releases the lease it took
  on every path out, including one where the run fails — a claim held by nobody
  would make a run that has demonstrably stopped look like one still being
  worked on. A run that took its own lease releases it when it settles, and
  **cancellation is settling**: a Ctrl-C'd run hands the claim back as soon as
  its record is terminal, rather than holding it for the rest of the TTL. The two
  exceptions are a lease that was *lost* (not ours to give back) and a process
  that breaks before it can release, where the claim lapses at its TTL instead.
- **A crashed holder's claim lapses at the TTL.** Nothing polls for it: expiry is
  evaluated by the store the next time somebody tries to acquire — and until
  somebody does, a lapsed claim is still its holder's: a renewal extends it
  whatever its expiry says. So "expired" is not "abandoned", and nothing may
  delete a lock record on expiry alone. `runs prune` deliberately leaves them
  behind for that reason; clearing one belongs to whoever can *prove* the holder
  is gone, which a sweep does by acquiring it.
- **A run that cannot take its lease does not start.** Acquiring is retried past
  a store having a bad moment, but a store that never answers fails the run with
  a named error rather than running unclaimed — a `running` record with no holder
  is exactly what a sweep reads as abandoned, so running without one would leave
  a healthy build looking dead for its whole duration.
