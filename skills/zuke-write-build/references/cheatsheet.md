# Zuke authoring cheatsheet

A quick map for writing targets. **Always confirm exact signatures** against
`llms-full.txt` (repo root) or `deno doc jsr:@zuke/<package>` — this is a
summary, not the source of truth.

## `target()` — the fluent builder

Everything is optional except a body (`.executes`).

| Method                                                                                                   | Purpose                                                                                             |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `.description(text)`                                                                                     | Summary shown in `--list`.                                                                          |
| `.dependsOn(...t)`                                                                                       | Hard prerequisites; run first, transitively. Pass `this.<field>`.                                   |
| `.executes(fn)`                                                                                          | The body. Sync or async. **Required.** `fn` may take a `TargetContext` (`(ctx) => …`); see below.   |
| `.before(...t)` / `.after(...t)`                                                                         | Soft ordering — only reorders targets already in the plan; never pulls new ones in.                 |
| `.triggers(...t)`                                                                                        | Pull targets into the plan and run them _after_ this one.                                           |
| `.dependentFor(...t)`                                                                                    | Reverse of `dependsOn`: make this a prerequisite of others.                                         |
| `.inputs(...p)` / `.outputs(...p)`                                                                       | Incremental cache: skip when inputs unchanged and outputs exist.                                    |
| `.cacheKey(fn)`                                                                                          | Add a non-file value (version, git sha, param) to the cache fingerprint.                            |
| `.onlyWhen(cond)`                                                                                        | Run only when the (possibly async) predicate holds, else skip.                                      |
| `.requires(...params)`                                                                                   | Fail unless the listed parameters resolved to a value.                                              |
| `.retry(times, delayMs?)`                                                                                | Retry the body on failure.                                                                          |
| `.timeout(ms)`                                                                                           | Fail the body if it runs longer than `ms` (per attempt).                                            |
| `.lock((s) => s.lockKey(...).withTtl(...))`                                                              | Hold a cross-run lock while running; a second run wanting the key fails. See below.                 |
| `.waitsFor((s) => s.on(externalSignal(...)))`                                                            | Gate (no body): suspend the run until an external event; resume later. See below.                   |
| `.onCancel(() => this.rollback)`                                                                         | Compensation run (reverse order) iff this target succeeded when the run is cancelled. See below.    |
| `.forEach(() => items, (item) => ({stage: target()…}), (s) => s.concurrency(3).continueOnItemFailure())` | Fan out a pipeline over a runtime list: items concurrent, stages sequential per item. See below.    |
| `.proceedAfterFailure()`                                                                                 | Keep the build going if this target fails.                                                          |
| `.always()`                                                                                              | Run even after the build failed (cleanup/teardown).                                                 |
| `.unlisted()`                                                                                            | Hide from `--list`/`--help`; still runnable by name.                                                |
| `.dryRunnable()`                                                                                         | Run this body under `--dry-run` with `$` in echo mode (prints argv, no spawn); others stay skipped. |
| `.validateBefore(...v)` / `.validateAfter(...v)`                                                         | Run `Validation` checks around the body; a throw fails the target.                                  |
| `.recoverWith(...r)` / `.recoverAttempts(n)`                                                             | Run `Remediation`s if the body fails (self-healing); re-run when one asks to. See AI section.       |
| `.partOf(group)`                                                                                         | Join a parallel batch (see `group()`).                                                              |
| `.produces(...p)` / `.consumes(...t)`                                                                    | Declare and consume artifact paths.                                                                 |

**External ordering:** `override extraEdges(targets)` on the `Build` returns
`[before, after]` pairs (from the discovered `targets` map) to impose soft
ordering beyond per-target `.before()`/`.after()` — the seam for feeding an
external dependency graph in. `override orderWith(targets)` is the same, but
**async and resolved per run** (load the graph at run time); its edges merge
with `extraEdges`. Cycle-checked; edges outside the run's set are ignored; both
are honoured by a run and `zuke cancel`, but not by static `graph`/`--list`.

## `group()` — parallel batches

```ts
checks = group();

clean = target().executes(/* ... */);
lint = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
format = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);

ship = target().dependsOn(this.checks).executes(/* ... */); // waits for all members
```

Members of a group run concurrently with each other (each still awaiting its own
deps), no `--parallel` flag needed. Declare the group field above its members.

## Components — reusable target bundles

A component is a function returning related targets; discovery names them with a
dotted path (`release.publish`).

```ts
function releasable(opts: { registry: string }) {
  const pack = target().executes(/* ... */);
  const publish = target().dependsOn(pack).executes(/* ... */);
  return { pack, publish };
}

class MyBuild extends Build {
  release = releasable({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* ... */);
}
```

## Services — long-lived processes

`service()` models a process that must stay **running while its dependents
execute** (dev server, DB container, mock API). Declared and depended on like a
target, but with a lifecycle instead of `.executes(...)`: the executor starts
it, waits until ready, keeps it alive, then stops it in a `finally` (reverse
order) so a failed test never leaks a process.

```ts
import { Build, run, service, target, tcpReachable } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";

class E2E extends Build {
  api = service()
    .description("API under test")
    .start(() => $`deno run -A server.ts`.spawn()) // spawn — don't await
    .readyWhen(() => tcpReachable("localhost:8080")); // polled until ready

  test = target()
    .dependsOn(this.api) // started + ready before this runs
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}
```

| Method                      | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `.start(() => handle)`      | Start the process; return a handle with `.stop()`. **Required.** |
| `.readyWhen(() => boolean)` | Readiness probe, polled (200ms) until `true`.                    |
| `.readyTimeout(ms)`         | Wait before failing readiness (default 30s).                     |
| `.stop((handle) => …)`      | Custom teardown; receives what `.start()` returned.              |

The shell's `Command` gains `.spawn()` (starts without awaiting, returns a
`SpawnedProcess` whose `.stop()` sends `SIGTERM`) — a valid handle, so the
common case needs no explicit `.stop()`. `tcpReachable("host:port")` is the
built-in "is the port up yet?" probe. Shares `dependsOn`/`before`/`after`/
`description` with `target()`.

## Target context — `ctx`

A body may accept a `TargetContext`. Zero-argument bodies keep working — the
parameter is optional.

```ts
deploy = target().executes(async (ctx) => {
  ctx.runId; // stable id for the whole run
  ctx.target; // "deploy"
  ctx.signal; // AbortSignal, fired when the run is cancelled
  ctx.dryRun; // true under a dry run
  await ctx.state.set({ where: "sit-7" }); // durable metadata — see below
  ctx.stateOf("build").get(); // read ANOTHER target's published state
  ctx.signals.get("approved"); // an external signal's payload (see waits)
});
```

**Cancellation.** When the run is cancelled, `ctx.signal` fires and any plain
`` $`…` `` in the body is terminated with `SIGTERM` automatically (the run's
signal is the shell's ambient signal). Pass `ctx.signal` to `.signal(...)` to
cancel a command explicitly; it composes with `.killAfter(ms)`. Cancel a run
with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, the MCP `cancel_run` tool, or
programmatically with `execute(build, root, { signal })` /
`cancelRun(build, {
runId })`. A body that ignores its signal and never shells
out runs to completion. Register **compensations** with `.onCancel(...)` (see
below) to undo a target's effect when the run is cancelled.

## Durable run state

Persist a run's status and per-target metadata so it survives the process
exiting. **Opt-in** — a plain build writes nothing. Enable a store by (first
wins): `execute(..., { stateStore })` → `override stateStore()` →
`ZUKE_STATE_URL` (+ `ZUKE_STATE_TOKEN`) → `ZUKE_STATE_DIR` → `--state` (defaults
to `.zuke/runs`).

```ts
import { Build, HttpStateStore, target } from "jsr:@zuke/core";

class CD extends Build {
  override stateStore() {
    return new HttpStateStore({ url: this.url.value, token: this.token.value });
  }
  deploy = target().executes(async (ctx) => {
    await ctx.state.set({ image: tag }); // JSON patch, merged and persisted
    const meta = ctx.state.get(); // read back (this run and later ones)
  });
}
```

- Backends: `FileSystemStateStore(dir)` (single host, dev) and
  `HttpStateStore({ url, token? })` (hosted, production — see
  `docs/state-api.md`). Both dependency-free and pluggable behind `StateStore`.
  A hosted backend is verified with the **conformance kit**
  (`deno run -A jsr:@zuke/core/conformance --url <base> [--token …]`, or
  `checkStateStore`/`checkBuildRegistry` from `@zuke/core/conformance`) — it
  exercises CAS, listing, and TTL-lock semantics. The HTTP clients stamp every
  request with `x-zuke-state-protocol: 1` and fail loudly on a server-declared
  mismatch.
- The run record holds status, the graph shape, resolved **non-secret**
  parameters, and per-target status/timing/metadata. Inspect it from the CLI
  with `zuke runs list [--status <s>] [--target <t>] [--since <iso>] [--limit <n>] [--counts]`
  (newest first) and `zuke runs show <id>` (`--json` on both), or programmatically
  with `store.listRuns({ status?, target?, since?, limit? })` and `store.getRun(id)`.
- **Retention:** `zuke runs prune --keep <age> --keep-last <n>` deletes only
  **terminal** runs matching neither rule (`--dry-run` to preview); a
  non-terminal run (suspended/running) is never pruned. The FS store owns
  pruning via the CLI; for the HTTP backend retention is the server's job
  (`GET /runs` takes `limit`; `DELETE /runs/:id` is optional). See `docs/state.md`.
- **Never put secrets in `ctx.state`** — it is stored as plain JSON. Secret
  parameters are excluded from the record and state values are run through the
  redactor, but treat state as a non-secret channel. See `docs/state.md`.

## Cross-run locks

`.lock((s) => …)` takes a **settings lambda** (like the tool wrappers) and
claims an exclusive resource across runs and machines. A second run that wants
the same key **fails** with a `LockConflictError` (naming the holder) — it does
not queue.

```ts
import { Build, target } from "jsr:@zuke/core";

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
  machines. See `docs/locks.md`.

## External-event waits

`.waitsFor((s) => …)` makes a target a **gate** (no body): the run proceeds past
it only when the trigger is satisfied; otherwise it **suspends** — the run's
state is saved, independent branches finish, and the process exits 0 — to be
resumed later in a fresh process.

```ts
import { Build, externalSignal, target } from "jsr:@zuke/core";

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
  per-job result with `readWorkflowResult(ctx.stateOf("<gate>"))`). By default it
  correlates via a marker echoed into the run's `run-name:`; for a workflow you
  can't modify use `.correlate("created-window")` (best-effort). Either way it
  **fails fast** (`.discoveryTimeout(...)`, default 1m) if the run never
  correlates, instead of eating the whole `.timeout()`. Write your own trigger
  against the exported `WaitTrigger` / `WaitContext` interface.
- Needs a state store (a build with `.waitsFor()` enables `.zuke/runs` by
  default). A resume is a fresh process, so **only `ctx.state`/`ctx.signals`
  cross the boundary**. See `docs/orchestration.md`.
- Continue a suspended run with
  `zuke resume <id> --signal <name> [--data <json>]` (or
  `zuke resume --check [<id>]` for predicate waits/timeouts). Resumption is
  **exactly-once** (concurrent resumers get `AlreadyResumedError`) and re-runs
  only the not-yet-succeeded targets; `--force-graph` overrides a changed graph.

## Cancellation & compensation — `.onCancel()`

Undo a target's effect when the run is cancelled.
`.onCancel(target | () =>
target)` registers a **compensation** that runs **iff
this target succeeded**; on cancel, compensations run in **reverse order** of
the succeeded targets.

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
  the work).
- Cancel with `zuke cancel <id>`, `Ctrl-C`/`SIGTERM`, or the MCP `cancel_run`
  tool (all run the same walk). A live run aborts on its next state write.
- A compensation that throws is recorded but does **not** stop the walk (cleanup
  is maximal). Cancelling a finished run is a friendly no-op.
- A timed-out `.waitsFor()` can route here: `.onTimeout(() => "cancel-run")`
  cancels the run (running compensations); `.onTimeout(() => this.cleanup)` runs
  that target too. Needs a state store (a build with `.onCancel()` enables
  `.zuke/runs` by default). See `docs/orchestration.md`.

## Fan-out over a list — `.forEach()`

Run the same pipeline over a runtime list, with per-item isolation and bounded
concurrency:

```ts
import { Build, parameter, target } from "jsr:@zuke/core";

class CD extends Build {
  repos = parameter("services").required().array();

  deployBatch = target().forEach(
    () => this.repos.value, // items: thunk, read when the target runs
    (repo) => ({ // ordered pipeline per item (each stage depends on the prev)
      checks: target().executes(() => checkDeployable(repo)),
      deploy: target().executes((ctx) => applyToSit(repo, ctx)),
    }),
    (s) => s.concurrency(3).continueOnItemFailure(),
  );
}
```

- Items run **concurrently** (up to `.concurrency(n)`, default CPU count); each
  item's stages run **sequentially** — the pipeline model, no barrier between
  items.
- `.continueOnItemFailure()` isolates a failed item (its later stages skip, the
  others finish); otherwise the first failure stops the batch. Either way the
  fan-out target fails if any item did.
- Sub-targets are materialised at run time (`deployBatch[<item>].<stage>`), each
  a first-class row in the summary and the [run record](#durable-run-state) (so
  `zuke runs show` reports per-item verdicts). `--list`/`graph` show the one
  node, annotated `[fan-out]`.
- **Per-item compensation:** an `.onCancel(...)` on a fan-out **stage** runs on
  cancel for each item that had succeeded — or was still in-flight — with its own
  item-scoped `ctx.state`, in reverse order, before the parent's own `.onCancel`.
  The item list must be deterministic (cancel re-materialises it to find items).
- Pairs with array params: `.options(...).array()` / `.number().array()` type
  and validate the list before the batch runs.

## Parameters — typed build inputs

```ts
import { Build, parameter, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  apiKey = parameter("Anthropic API key").secret().required();
  env = parameter("Target environment"); // optional

  deploy = target()
    .requires(this.apiKey)
    .onlyWhen(() => this.env.value === "production")
    .executes(() => {/* use this.apiKey.value */});
}
```

Secrets are masked in CI output. Read a resolved value with `this.x.value`.

Kinds & modifiers: `.number()` → `number`, `.boolean()` → `boolean` (a flag,
defaults to `false`), `.options("a", "b")` restricts a string, `.secret()`
masks + redacts, `.default(v)`/`.required()` set optionality, `.env(NAME)`
overrides the env var.

Lists: `.array()` (comma-separated or repeated flag) comes **last** and
composes — `.options("a", "b").array()` validates each element, and
`.number().array()` yields a `number[]`. Order is kind/options →
`.required()` → `.array()`: put `.required()` **before** `.array()`
(`.required().array()`), not after — `.array().required()` fails to typecheck,
and a non-required list defaults to `[]`.

### Secrets from a manager — `.from(source)`

A `.secret()` parameter can be **sourced at run time** so the value never lands
in a shell, `.env`, or CI YAML — and its resolved value is **redacted from all
of Zuke's output**:

```ts
import { execSecret, parameter } from "jsr:@zuke/core";

token = parameter("Deploy token")
  .secret()
  .from(
    execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")),
  );
```

A sourced secret is still an ordinary parameter (flag, env var, `.required()`,
`.number()`); `.from(...)` just adds the run-time provider.

## Provisioning tools — hermetic builds

Fetch pinned, checksum-verified tool binaries from the build itself instead of
assuming they're installed. Both return the installed binary's `AbsolutePath`;
hand it to a wrapper's `.toolPath(...)`, to `CmdTasks`, or to `defineTool`.

```ts
import { toolchain, ToolTasks } from "jsr:@zuke/core";

// One release binary:
bin = target().executes(async () =>
  await ToolTasks.install((s) =>
    s.name("shellcheck").url(shellcheckUrl).checksum(shellcheckSum)
  )
);

// Many at once — release binaries via .tool(), npm packages via .npm():
tools = toolchain((t) =>
  t.tool((s) => s.name("helm").url(helmUrl))
    .npm({ name: "vitest", version: "4.1.9" })
);
// install() returns Map<name, AbsolutePath>; npm packages need `npm` on PATH.
```

`.archive("tar.gz")` or `.archive("zip")` unpacks an archive and copies
`.binaryPath(...)` (default the name) out — zip reading covers the `stored`/
`deflate` methods release assets use, rejects encrypted/zip64 archives, and
blocks zip-slip. `.checksum(sha256)` verifies (the archive's SHA-256 for an
archive, the binary's for `"raw"`) and doubles as the install cache key.

**Multi-file runtimes (Node.js, a JDK, …)** — `ToolTasks.installTree((s) => …)`
(or `toolchain().tree((s) => …)`) keeps the *whole* extracted tree instead of one
binary, for a runtime that ships several bins plus `lib/`. `.strip(1)` unwraps the
`tool-v1.2.3/` top directory, `.bins("bin/node", "bin/npm")` marks executables
(symlinks preserved). It returns the tree root as a callable `AbsolutePath`, so
`root("bin", "node")` is a binary and `root("bin")` the directory to put on PATH:

```ts
import { prependPath, ToolTasks } from "jsr:@zuke/core";

const node = await ToolTasks.installTree((s) =>
  s.name("node").archive("tar.gz").strip(1).bins("bin/node", "bin/npm")
    .url(nodeUrl).checksum(nodeSum)
);
prependPath(node("bin")); // node/npm (and node_modules/.bin shims) now on PATH
```

`prependPath(dir)` puts `dir` first on the process `PATH` (idempotent, platform
separator) so every subprocess Zuke spawns — the shell `$`, `Command`, and the
tool wrappers, which inherit `Deno.env` — finds the provisioned tool.

**Resolve from `node_modules/.bin`** — in a Node monorepo where tool binaries
are hoisted to the repo root, a wrapper can find its binary npx-style instead of
needing a `.toolPath(...)`. `.fromNodeModules()` on any settings object walks up
from the working directory for `node_modules/.bin/<tool>` (the `.cmd`/`.bat`
shims on Windows, launched via `cmd /c`) and falls back to `PATH` on a miss;
`.fromPath()` forces `PATH`; and `ZUKE_TOOL_RESOLUTION=node_modules|path` flips
every wrapper repo-wide without touching call sites (a per-call setting wins
over it). An explicit `.toolPath(...)` always wins, so a `toolchain()` pin stays
hermetic. `resolvedArgv()` shows what a run will spawn. See `docs/tools.md`.

## Tool wrappers — the settings-lambda style

Every external tool is a `*Tasks` object; each task takes `(s) => s.…` mirroring
the real CLI's flags. A non-exhaustive map (run `deno doc jsr:@zuke/<pkg>` for
the full task list and settings methods of each):

| Package                                                                                                                                        | Object                                           | Typical tasks                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `@zuke/core`                                                                                                                                   | `FileTasks`, `AnnounceTasks`, `ToolTasks`        | copy/move/remove files; Slack/Teams/Discord posts; install tool binaries            |
| `@zuke/console`                                                                                                                                | `ConsoleTasks`                                   | themed console output (headings, notices) so a build never hand-rolls `console.log` |
| `@zuke/deno`                                                                                                                                   | `DenoTasks`                                      | `check`, `test`, `fmt`, `lint`, `cache`, `doc`, `run`, `publish`                    |
| `@zuke/docs`                                                                                                                                   | `DocsTasks`                                      | turn generated API docs into published output                                       |
| `@zuke/npm`, `@zuke/npx`, `@zuke/bun`, `@zuke/pnpm`, `@zuke/yarn`, `@zuke/node`                                                                | `NpmTasks`, `NpxTasks`, `BunTasks`, ...          | JS package managers + `npx` runner + `node`                                         |
| `@zuke/cmd`                                                                                                                                    | `CmdTasks`                                       | `exec` — generic fallback for any CLI                                               |
| `@zuke/docker`, `@zuke/docker-compose`                                                                                                         | `DockerTasks`, ...                               | build/run/compose                                                                   |
| `@zuke/git`, `@zuke/gh`                                                                                                                        | `GitTasks`, `GhTasks`                            | git and GitHub CLI                                                                  |
| `@zuke/cspell`, `@zuke/eslint`, `@zuke/oxlint`, `@zuke/biome`, `@zuke/dprint`, `@zuke/knip`, `@zuke/dpdm`                                      | `*Tasks`                                         | lint/format/spell/dead-code                                                         |
| `@zuke/tsc`, `@zuke/tsgo`, `@zuke/tsx`, `@zuke/tsc-alias`, `@zuke/tsup`, `@zuke/tsdown`, `@zuke/vite`, `@zuke/turbo`, `@zuke/nx`, `@zuke/nest` | `*Tasks`                                         | TS compile / bundle / monorepo / framework CLIs                                     |
| `@zuke/openapi-ts`, `@zuke/orval`                                                                                                              | `*Tasks`                                         | generate API clients from OpenAPI                                                   |
| `@zuke/husky`                                                                                                                                  | `HuskyTasks`                                     | git hooks                                                                           |
| `@zuke/jest`, `@zuke/vitest`, `@zuke/playwright`, `@zuke/cypress`                                                                              | `*Tasks`                                         | test runners                                                                        |
| `@zuke/jsr`, `@zuke/codecov`, `@zuke/release-please`                                                                                           | `JsrTasks`, `CodecovTasks`, ...                  | publish / coverage upload / releases                                                |
| `@zuke/kubectl`, `@zuke/helm`, `@zuke/kustomize`, `@zuke/terraform`, `@zuke/tofu`, `@zuke/gcloud`                                              | `*Tasks`                                         | infra/deploy                                                                        |
| `@zuke/security`                                                                                                                               | `*Tasks`                                         | security scanning                                                                   |
| `@zuke/claude`, `@zuke/codex`, `@zuke/gemini`                                                                                                  | `ClaudeTasks`, ...                               | headless AI CLIs                                                                    |
| `@zuke/ai`                                                                                                                                     | `securityReviewer`, ..., `aiFixer`, `agentFixer` | AI review gates + self-healing (see below)                                          |

The catalog keeps growing — `deno doc jsr:@zuke/<pkg>` (or the package list in
`llms.txt`) is the source of truth for what exists.

```ts
await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check().paths("mod.ts"));
await CmdTasks.exec("my-tool", (s) => s.args("--flag", "value")); // no wrapper? use cmd
```

## AI review & self-healing — `@zuke/ai`

A model becomes part of the build graph two ways. Only the provider (`"claude"`
| `"openai"` | `"gemini"`) and an API key (pass a `parameter().secret()`) are
required; everything else is defaulted.

**Review gate** — a reviewer is a `Validation`; attach with `.validateBefore` /
`.validateAfter`. It scores the diff and breaks the build past a threshold.

```ts
import { securityReviewer } from "jsr:@zuke/ai";

key = parameter("OpenAI API key").secret();
review = securityReviewer((r) =>
  r.provider("openai").apiKey(this.key).failWhen((g) => g.scoreAbove(8))
);
deploy = target().validateBefore(this.review).executes(() => {/* ... */});
```

Factories: `securityReviewer`, `secretsReviewer`, `correctnessReviewer`,
`licenseReviewer`, `genericReviewer`.

**Self-healing** — `aiFixer` is a `Remediation`; attach with
`.recoverWith(...)`. On a failing body it diagnoses the failure and (safe
default) posts the diagnosis + a committable, Copilot-style inline suggestion to
the PR — writing no files. The build re-runs the real command to verify any
applied fix.

```ts
import { aiFixer } from "jsr:@zuke/ai";

// Per target:
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));

// Or globally — override recoverWith() to attach a fixer to EVERY target:
override recoverWith() {
  return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
}
```

Both compose: a target's own `.recoverWith(...)` runs first, then the
build-level `recoverWith()`. Opt into changes with `.autoApply()` (path
allowlist, file cap, local-only unless `.allowCI()`) and `.commitFixes()`;
`.diff((d) => d.fetchBase())` fetches the PR base branch for context so CI needs
no manual `git fetch`. Keys ride through `parameter().secret()`, which Zuke
masks in CI output.

**Delegate to a coding agent** — `agentFixer(runner)` is a `Remediation` that
hands the failure to a coding agent you inject (`@zuke/claude`, `@zuke/codex`,
`@zuke/gemini`) which edits files itself, then re-runs the target to verify. One
generic fixer, agent chosen at the call site; local-only unless `.allowCI()`.

```ts
import { agentFixer } from "jsr:@zuke/ai";
import { ClaudeTasks } from "jsr:@zuke/claude";

test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(
    agentFixer((ctx) =>
      ClaudeTasks.run((s) => s.prompt(ctx.prompt).permissionMode("acceptEdits"))
    ),
  );
```

## OpenTelemetry export — `@zuke/otel`

A plugin that ships run/target spans and counters to an OTLP/HTTP JSON
collector. Register it on the run, not the build — it observes durable run
state, so a **state store is required**.

```ts
import { run } from "jsr:@zuke/core";
import { otel } from "jsr:@zuke/otel";

await run(MyBuild, {
  plugins: [
    otel((s) =>
      s.endpoint("http://localhost:4318") // else OTEL_EXPORTER_OTLP_ENDPOINT
        .serviceName("my-build") // else OTEL_SERVICE_NAME
        .header("authorization", "Bearer …") // else OTEL_EXPORTER_OTLP_HEADERS
    ),
  ],
});
// Or fully env-driven: run(MyBuild, { plugins: [otel()] })
```

- Exports a **trace** (run span + one child span per executed target) when the
  run settles, plus `zuke.run.started` / `zuke.run.suspended` /
  `zuke.runs{outcome}` counters.
- The trace id is `SHA-256(runId)`, so a **suspend/resume across processes is
  one trace** — the finishing process exports the complete, gap-spanning run.
- **Inert with no endpoint** (safe to always register); **best-effort** (a dead
  collector never fails the build); the record is **secret-free**. No runtime
  deps. See `docs/observability.md`.

## Helpers from `@zuke/core`

- `glob(pattern, { cwd? })` — expand a glob to sorted paths.
- `assert(cond, msg?)`, `assertExists(v, msg?)`, `fail(msg)`,
  `assertFileExists(path)` — fail a target fast with a clear message.
- `httpDownload(url, dest)`, `httpText(url)`, `httpJson(url)` — fetch helpers
  that throw `HttpError` on non-2xx.
- `$` from `jsr:@zuke/core/shell` — injection-safe tagged-template shell, only
  when no typed wrapper fits.

## Code-first CI — `cicd()`

```ts
ci = cicd({ provider: "github" }); // .github/workflows/ci.yml, push/PR to main
```

`provider` is the only required field (`"github"` / `"gitlab"` / `"azure"`).
Running any target regenerates the YAML; on CI it _verifies_ the committed file
is current (`zuke generate-ci --check` is a dedicated gate).

**Scheduled runs** — `triggers.schedule: [{ cron, tz? }]`. A `tz` (IANA zone) is
compiled to UTC cron(s); a daylight-saving zone also emits a generated guard job
so only the correct wall-clock firing proceeds. Full on GitHub; Azure gets
native `schedules:` for UTC/fixed-offset (DST zone errors); GitLab/Bitbucket
schedules are UI-side and ignored. Numeric fields + whole-hour offsets only,
else a friendly error.
`cicd({ provider: "github", pipeline: { triggers: { schedule: [{ cron: "30 9 * * 1-5", tz: "Europe/Sofia" }] } } })`.

## Run & inspect

```sh
./zuke --list                 # all targets
./zuke --list --json          # whole surface (commands, flags, targets) as JSON
./zuke <target> --dry-run     # preview the plan, run nothing
./zuke <target>               # run it
./zuke <target> --parallel    # run independent targets concurrently
./zuke <target> --affected    # run only targets changed since a git base
./zuke <target> --no-cache    # ignore the incremental cache
./zuke <target> --state       # persist run state to .zuke/runs (durable state)
./zuke <target> --actor <who> # attribute the run in its state record
./zuke runs list [--status s] # list persisted runs (also --target, --since, --limit, --counts, --json)
./zuke runs show <id>         # one run's full per-target status (+ --json)
./zuke runs prune --keep 90d --keep-last 50  # delete old terminal runs (--dry-run to preview)
./zuke resume <id> --signal <name> [--data <json>]  # continue a suspended run
./zuke cancel <id>            # cancel a run and run its .onCancel() compensations
./zuke mcp [--allow-run]      # serve the build over MCP for an AI client (stdio)
./zuke mcp --http 7777        # ...or over HTTP (loopback; token off-loopback; Origin-guarded)
./zuke mcp --http 7777 --allowed-origin https://app.example  # permit an extra browser Origin
./zuke mcp --allow-run=deploy,checks* --protect deploy --confirm-destructive
                              # authz tiers: allow-list, operator token, confirm
./zuke runs show mcp-audit    # the MCP tool-call audit trail
./zuke register [--json]      # record this build in the build registry (idempotent)
./zuke doc jsr:@zuke/deno     # print a package's API (deno doc) from an isolated empty dir
./zuke mcp --registry --allow-run  # serve the registry: registered builds as tools, spawned
./zuke mcp --registry --max-concurrent-runs 4  # cap concurrent run-tool spawns (default 4)
```

**Build registry** (`docs/registry.md`): `zuke register` writes a secret-free
descriptor of this build — its `describeCli()` surface (targets, params) plus a
launch location — into a pluggable `BuildRegistry`. Resolved like the state
store: `ZUKE_REGISTRY_URL`/`_TOKEN` (HTTP) or `ZUKE_REGISTRY_DIR` (files), a
`registry()` build override, else `.zuke/builds`. Separate from the run store;
an HTTP backend shares the `/builds` REST contract beside `/runs`.
**`zuke mcp
--registry`** then serves the whole catalog — re-read live, so a
build registered by another process appears as a `run:<buildId>:<target>` tool
with no restart and runs by spawning its launch location (behind `--allow-run` +
the same authz). The run tool exposes the registered build's declared
**parameters** as its input schema and forwards supplied values to the spawned
build as `--flag=value` arguments — validated against their kinds first (a type
mismatch is a clean tool error, never a failed subprocess). `.secret()`
parameters are omitted from the descriptor entirely, so a secret can neither be
requested nor forwarded; the child resolves it from its own environment /
`.from()` source.

**Trusted per-call identity** (`docs/mcp.md`): on a shared, multi-user endpoint,
`override mcpIdentity()` returns a hook `(ctx) => ({ actor, via? })` that
resolves the **real** caller from a request header an authenticating reverse
proxy injects (`ctx.headers.get("x-forwarded-user")`). It runs once per request
before any dispatch; its actor overrides `--actor`/env/the client label and
flows to the audit trail, run records, lock holders, and a registry-spawned
child's `ZUKE_ACTOR`. A **throwing hook rejects the request** (nothing runs,
nothing is written). The minimal seam — TLS/OAuth/header-stripping is the
proxy's job.

**Caching:** a target with `.inputs(...)`/`.outputs(...)` is incremental
(skipped and reported `cached` when inputs are unchanged and outputs exist). Add
a **remote store** to share results across machines — a fresh CI checkout or a
teammate's clone restores outputs instead of rebuilding; `--no-remote-cache`
uses the local cache only. `--affected` limits a run to targets touched since a
git base (great for CI job fan-out).
