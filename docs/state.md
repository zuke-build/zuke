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

| Precedence | Source                                             | Selects                                    |
| ---------- | -------------------------------------------------- | ------------------------------------------ |
| 1          | `execute(build, root, { stateStore })`             | that store (`false` disables state)        |
| 2          | `Build.stateStore()` override                      | the returned store                         |
| 3          | `ZUKE_STATE_URL` (+ optional `ZUKE_STATE_TOKEN`)   | an {@link HttpStateStore} (production)     |
| 4          | `ZUKE_STATE_DIR`                                   | a `FileSystemStateStore` at that directory |
| 5          | `--state` (CLI) with nothing above set             | a `FileSystemStateStore` at `.zuke/runs`   |

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
  "id": "3f2a…",                 // == ctx.runId
  "build": "CD",                  // the Build class name
  "rootTarget": "deploy",         // the requested target
  "status": "succeeded",          // running | suspended | succeeded | failed | cancelled
  "actor": "alice",               // who ran it (see below)
  "createdAt": "2026-07-17T…Z",
  "updatedAt": "2026-07-17T…Z",
  "graph": [                      // the shape it planned, in declaration order
    { "name": "build", "dependsOn": [] },
    { "name": "deploy", "dependsOn": ["build"] }
  ],
  "params": { "env": "sit" },     // resolved, NON-secret parameters only
  "targets": {
    "build":  { "status": "succeeded", "meta": {}, "startedAt": "…", "endedAt": "…" },
    "deploy": { "status": "succeeded", "meta": { "target": "sit-7" }, "startedAt": "…", "endedAt": "…" }
  }
}
```

A target's `status` is one of `pending`, `running`, `succeeded`, `failed`,
`skipped` (and `waiting`, from a later milestone). This is a **separate
vocabulary** from the console's `passed`/`cached`: both of those map to
`succeeded` in the record.

The executor writes the record when it is created, on each target's start and
finish, and when the run ends. So if the process is killed mid-run, the record
on disk shows the target that was executing as `running`, with its `startedAt`
stamped.

## Per-target state — `ctx.state`

`ctx.state` ([run context](./run-context.md)) is a small durable key/value
store scoped to the current target:

```ts
deploy = target().executes(async (ctx) => {
  await ctx.state.set({ target: "sit-7", image: tag }); // merge a JSON patch
  const meta = ctx.state.get(); // read it back (this run and later ones)
});
```

`set` merges a JSON patch into the target's `meta` and awaits the write; `get`
returns the current metadata. When no store is configured, the handle is an
in-memory no-op — `set`/`get` are consistent within the run, but nothing is
persisted. It is the carrier for anything that must survive across a
suspend/resume boundary in later milestones.

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

```ts
import { FileSystemStateStore } from "jsr:@zuke/core";
const store = new FileSystemStateStore(".zuke/runs");
```

### `HttpStateStore` — hosted service, for production

Talks to an HTTP service you host, using ETags for optimistic concurrency. This
is the production path: point several machines (CI, developers) at one service
and they share run state. The one-page contract is in
[the state HTTP API](./state-api.md).

```ts
import { HttpStateStore } from "jsr:@zuke/core";
const store = new HttpStateStore({ url: "https://zuke-state.internal", token });
```

> **Security.** A store's URL/token and directory are trusted configuration:
> run records (with non-secret parameters and target metadata) are sent there.
> Point it only at a store you control, and prefer a secret parameter or an
> environment variable over a hard-coded value.

## Concurrency & compare-and-swap

Writes are **compare-and-swap**: each write carries the version the writer last
read, and only lands if the stored version still matches. Two writers racing at
the same version → exactly one wins; the loser gets a typed conflict and
re-reads. Within a single process, Zuke serialises its own writes, so conflicts
only arise across processes (which a later milestone — resuming a suspended run
— relies on).

State writes are **best-effort**: a store that is briefly unavailable is
reported through the run's reporter but never crashes the build. The build's
real work outweighs its bookkeeping.

## Inspecting runs

Programmatically, a store reconstructs runs from persistence alone:

```ts
const store = new FileSystemStateStore(".zuke/runs");
for (const summary of await store.listRuns({ status: "failed" })) {
  const { record } = (await store.getRun(summary.id))!;
  console.log(record.id, record.rootTarget, record.status);
}
```

`listRuns` filters by `status`, `target`, and `since`, newest first. Inspecting
runs from the command line (`zuke runs list` / `zuke runs show <id>`) lands with
the CLI surface for state — see the [CLI reference](./cli.md).
