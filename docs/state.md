# Durable run state

By default a Zuke run is entirely in-memory: when the process exits, all that
remains is the incremental [cache](./caching.md). **Durable run state** adds a
persistent, versioned record of a run — its status, the graph it ran, its
resolved (non-secret) parameters, and per-target progress — so that after the
process is gone you can reconstruct exactly what happened, and a target can
leave metadata behind for a later run to read.

It is **opt-in and zero-overhead when unused**: a plain build with no state
configuration writes nothing and pays nothing.

## Turning it on

A run gets a **state store** by the first of these that applies:

| Precedence | Source                                           | Selects                                    |
| ---------- | ------------------------------------------------ | ------------------------------------------ |
| 1          | `execute(build, root, { stateStore })`           | that store (`false` disables state)        |
| 2          | `Build.stateStore()` override                    | the returned store                         |
| 3          | `ZUKE_STATE_URL` (+ optional `ZUKE_STATE_TOKEN`) | an {@link HttpStateStore} (production)     |
| 4          | `ZUKE_STATE_DIR`                                 | a `FileSystemStateStore` at that directory |
| 5          | `--state` (CLI) with nothing above set           | a `FileSystemStateStore` at `.zuke/runs`   |

If none apply, the run has no store and no record is written.

```ts
import { Build, HttpStateStore, parameter, target } from "jsr:@zuke/core";

class CD extends Build {
  stateUrl = parameter("state service URL");
  stateToken = parameter("state service token").secret();

  override stateStore() {
    return new HttpStateStore({
      url: this.stateUrl.value,
      token: this.stateToken.value,
    });
  }

  deploy = target().executes(async (ctx) => {
    await ctx.state.set({ target: "sit-7" }); // persisted with the run
  });
}
```

## The run record

Each run is stored as one JSON document:

```jsonc
{
  "id": "3f2a…", // == ctx.runId
  "build": "CD", // the Build class name
  "buildId": "acme/api", // optional; which build instance owns it (see below)
  "rootTarget": "deploy", // the requested target
  "status": "succeeded", // running | suspended | cancelling | succeeded | failed | cancelled
  "actor": "alice", // who ran it (see below)
  "createdAt": "2026-07-17T…Z",
  "updatedAt": "2026-07-17T…Z",
  "graph": [ // the shape it planned, in declaration order
    { "name": "build", "dependsOn": [] },
    { "name": "deploy", "dependsOn": ["build"] }
  ],
  "params": { "env": "sit" }, // resolved, NON-secret parameters only
  "deadlineAt": "2026-07-17T…Z", // optional; from Build.deadline(), enforced by the reaper
  "intendedTerminal": "cancelled", // optional; set when a run enters `cancelling`
  "signals": {}, // external signals delivered to a .waitsFor() gate
  "events": [], // the audit trail (MCP tool calls, reap events)
  "targets": {
    "build": {
      "status": "succeeded",
      "meta": {},
      "startedAt": "…",
      "endedAt": "…"
    },
    "deploy": {
      "status": "succeeded",
      "meta": { "target": "sit-7" },
      "startedAt": "…",
      "endedAt": "…",
      "waitingFor": null, // the gate it is parked on, when suspended
      "effects": {} // per-effect intent + settlement, for crash re-drive
    }
  },
  "degraded": false // optional; true if a state write was lost (see below)
}
```

A target's `status` is one of `pending`, `running`, `succeeded`, `failed`,
`skipped`, and `waiting` (parked at a [`.waitsFor()`](./orchestration.md) gate).
This is a **separate vocabulary** from the console's `passed`/`cached`: both of
those map to `succeeded` in the record.

The executor writes the record when it is created, on each target's start and
finish, and when the run ends. So if the process is killed mid-run, the record
on disk shows the target that was executing as `running`, with its `startedAt`
stamped.

`buildId` is the run's **origin**: `ZUKE_BUILD_ID`, else `GITHUB_REPOSITORY`,
resolved once when the run is created. It says which build a run belongs to when
a store is shared, because the class name above cannot — a `zuke.ts` templated
across services shares its name, its target names and its graph. Every recovery
path compares it and touches a run only when the two origins agree; an absent one
on either side abstains rather than refusing, so records written before the field
existed stay recoverable. See
[Whose run is it?](./orchestration.md#whose-run-is-it).

A record also carries an append-only `events` array — the **audit trail** of
[MCP](./mcp.md) tool calls against the run (time, tool, actor, outcome, redacted
args). It is empty for a plain run and populated by the MCP server;
`zuke runs
show` prints it.

## Per-target state — `ctx.state`

`ctx.state` ([run context](./run-context.md)) is a small durable key/value store
scoped to the current target:

```ts
deploy = target().executes(async (ctx) => {
  await ctx.state.set({ target: "sit-7", image: tag }); // merge a JSON patch
  const meta = ctx.state.get(); // read it back (this run and later ones)
});
```

`set` merges a JSON patch into the target's `meta` and awaits the write; `get`
returns the current metadata. When no store is configured, the handle is an
in-memory no-op — `set`/`get` are consistent within the run, but nothing is
persisted. It is the carrier for anything that must survive a
[suspend/resume](./orchestration.md) boundary.

### Secrets never touch state

State is persisted in plain JSON and read back by later runs and by anyone who
can read the store, so it must never hold a secret:

- **Parameters:** only non-secret parameters are copied into `params`. A
  `.secret()` parameter is structurally excluded.
- **`ctx.state`:** every value written is run through the run's redactor first,
  so a secret value that slips into a patch is masked (`[redacted]`) before it
  is stored — a belt to the braces of "don't put secrets here."

See [Secrets](./secrets.md).

## Backends

Both backends are dependency-free and pluggable behind the `StateStore`
interface.

### `FileSystemStateStore` — single host, fine for dev

One JSON file per run under a directory (`.zuke/runs/<id>.json` by default).
Writes are atomic (write-temp-then-rename) and guarded by an `O_EXCL` lock file
so two processes on the **same host** cannot corrupt a record. The version used
for compare-and-swap is a content hash.

<!-- check -->

```ts
import { FileSystemStateStore } from "jsr:@zuke/core";
const store = new FileSystemStateStore(".zuke/runs");
```

### `HttpStateStore` — hosted service, for production

Talks to an HTTP service you host, using ETags for optimistic concurrency. This
is the production path: point several machines (CI, developers) at one service
and they share run state. The one-page contract is in
[the state HTTP API](./state-api.md), and the
[conformance kit](./state-api.md#notes-for-implementers)
(`deno run -A jsr:@zuke/core/conformance --url …`) verifies your backend against
it — don't re-derive correctness from the prose.

```ts
import { HttpStateStore } from "jsr:@zuke/core";
const store = new HttpStateStore({ url: "https://zuke-state.internal", token });
```

> **Security.** A store's URL/token and directory are trusted configuration: run
> records (with non-secret parameters and target metadata) are sent there. Point
> it only at a store you control, and prefer a secret parameter or an
> environment variable over a hard-coded value.

## Concurrency & compare-and-swap

Writes are **compare-and-swap**: each write carries the version the writer last
read, and only lands if the stored version still matches. Two writers racing at
the same version → exactly one wins; the loser gets a typed conflict and
re-reads. Within a single process, Zuke serialises its own writes, so conflicts
only arise across processes — which is exactly what
[resuming a suspended run](./orchestration.md) relies on: concurrent resumers
race this same compare-and-swap, and all but one get `AlreadyResumedError`.

State writes are **best-effort**: a store that is briefly unavailable is
reported through the run's reporter but never crashes the build. The build's
real work outweighs its bookkeeping.

### Degraded records

Most dropped writes lose nothing. The writer applies its mutation at the top of
its retry loop, so a compare-and-swap that conflicts is simply re-applied to the
freshly-read record on the next attempt; and when it gives up because the run
vanished from the store, or because the store threw, the mutation is still held in
memory for any later write to re-persist. Those paths warn and carry on.

One path genuinely loses a write. If a **foreign writer** — an MCP audit append,
a concurrent `zuke cancel` — wins the compare-and-swap race often enough to
exhaust the writer's retry budget, the last attempt's mutation is discarded along
with the base it was applied to. The writer then sets **`degraded: true`** on the
record, and the next write that _does_ land persists the flag (the failing write,
by definition, could not carry it). `zuke runs show` prints it. So `degraded`
means exactly one thing: **a mutation was permanently lost.**

The concrete consequence is a target that succeeded but is still recorded
`running` or `pending`. A resume trusts the record as written and re-runs every
target it does not show as `succeeded` — so that target would run a **second
time**, which for a deploy or a release means doing it twice. `zuke resume`
therefore **refuses** a degraded record and names that risk; `--resume-degraded`
accepts it and continues, because the operator — not Zuke — knows whether the
target is safe to repeat. `zuke resume --check` counts a degraded run as failed
on every sweep until an operator resolves it: a sweep cannot make that decision,
and a non-zero result is the only channel a cron watches. The run stays
`suspended` either way, so it remains resumable. See
[the CLI reference](./cli.md#resuming-suspended-runs).

A **cancellation** faces the same missing transition from the other side. It
normally compensates the targets recorded `succeeded`; on a degraded record that
test would skip a deploy that really happened, leaving it un-rolled-back. So
cancel widens the walk to every target whose success it cannot rule out —
anything not recorded `failed` or `skipped` — and its output says the record was
incomplete, not that the target had succeeded. Under-cleanup is the more
dangerous direction: a compensation that runs for work which never happened is a
no-op for an idempotent rollback (a delete of what was never created), while one
that is skipped leaves the side effect in place. See
[Cancellation](./orchestration.md#cancellation--compensation--oncancel).

If _no_ later write ever lands — a store that stays down for the rest of the run
— the flag never reaches the store. That run also never records its transition
to `suspended`, so there is nothing for a resume to continue: it reports the run
as missing or not suspended rather than resuming a record it cannot trust.

## Inspecting runs

From the command line, `zuke runs` reads records back from the store — a run's
status survives the process that produced it:

```sh
# All runs, newest first (id, status, target, actor, created).
zuke runs list

# Just the failed ones touching a given target, since a cutoff.
zuke runs list --status failed --target deploy --since 2026-07-01

# Aggregate counts instead of rows (total + per status); honours the filters.
zuke runs list --counts          # add --json for { total, byStatus }

# One run in full: header, parameters, per-target status, and signals.
zuke runs show 6f1c…             # add --json to emit the raw record
```

The store resolves the same way a run resolves it (`ZUKE_STATE_URL` /
`ZUKE_STATE_DIR`, a build's `stateStore()` override, or the default
`.zuke/runs`); with none configured, `runs` reports a friendly error. See the
[CLI reference](./cli.md#inspecting-runs) for every flag.

Programmatically, the same data is a `listRuns` / `getRun` away:

```ts
const store = new FileSystemStateStore(".zuke/runs");
for (const summary of await store.listRuns({ status: "failed" })) {
  const loaded = await store.getRun(summary.id);
  if (loaded === null) continue;
  console.log(loaded.record.id, loaded.record.rootTarget, loaded.record.status);
}
```

`listRuns` filters by `status`, `target`, and `since`, newest first, and takes a
`limit` (the newest N) so a large store stays listable.

## Retention

Records accumulate, so old ones can be pruned:

```sh
# Delete terminal runs older than 90 days, but always keep the newest 50.
zuke runs prune --keep 90d --keep-last 50

# Preview what would go, without deleting.
zuke runs prune --keep 30d --dry-run
```

A run is removed only when it is **terminal** (`succeeded`, `failed`,
`cancelled`) **and** matches neither rule — it is both older than `--keep` and
beyond the newest `--keep-last`. A **non-terminal** run (`suspended`, `running`,
`cancelling`) is **never** pruned: a run suspended for days awaiting a human is
the point of the system. At least one of `--keep` / `--keep-last` is required, so
an accidental bare `prune` never wipes the store.

Who owns retention depends on the backend. The **filesystem** store is
dev-grade and single-host, so it owns its pruning through this CLI. For the
**HTTP** backend, retention is the **server's** job (a TTL or scheduled sweep) —
`GET /runs` takes a `limit` so large stores stay listable, and `DELETE /runs/:id`
(which `prune` drives) is an optional endpoint a hosted store implements only if
it wants the CLI to prune it too. See [the state HTTP API](./state-api.md#notes-for-implementers).

## API stability

The durable-state surface — the `StateStore` interface, `resumeRun`,
`acquireLock`/`renewLock`/`releaseLock`, and the `RunRecord` / `RunEvent` shapes
— is **stable with a deprecation cycle**: a breaking change ships with the old
form kept working for one minor version, emitting a warning, before removal. The
`RunRecord` JSON is versioned by tolerant parsing (an older record still loads,
its missing fields defaulted), and that tolerance is a stated guarantee, not an
accident — the schema-evolution tests enforce it.

The HTTP wire contract carries an explicit
[protocol version](./state-api.md#conventions) (`x-zuke-state-protocol`); a
breaking change to the contract bumps the number, and a client fails loudly
against a server that declares a different one rather than mis-parsing silently.
Build the [conformance kit](./state-api.md#notes-for-implementers) into your
backend's CI so a contract change surfaces the moment it lands.
