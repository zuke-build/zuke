# Zuke authoring cheatsheet

A quick map for writing targets. **Always confirm exact signatures** against
`llms-full.txt` (repo root) or `deno doc jsr:@zuke/<package>` — this is a
summary, not the source of truth.

## `target()` — the fluent builder

Everything is optional except a body (`.executes`).

| Method                                           | Purpose                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `.description(text)`                             | Summary shown in `--list`.                                                                        |
| `.dependsOn(...t)`                               | Hard prerequisites; run first, transitively. Pass `this.<field>`.                                 |
| `.executes(fn)`                                  | The body. Sync or async. **Required.** `fn` may take a `TargetContext` (`(ctx) => …`); see below. |
| `.before(...t)` / `.after(...t)`                 | Soft ordering — only reorders targets already in the plan; never pulls new ones in.               |
| `.triggers(...t)`                                | Pull targets into the plan and run them _after_ this one.                                         |
| `.dependentFor(...t)`                            | Reverse of `dependsOn`: make this a prerequisite of others.                                       |
| `.inputs(...p)` / `.outputs(...p)`               | Incremental cache: skip when inputs unchanged and outputs exist.                                  |
| `.cacheKey(fn)`                                  | Add a non-file value (version, git sha, param) to the cache fingerprint.                          |
| `.onlyWhen(cond)`                                | Run only when the (possibly async) predicate holds, else skip.                                    |
| `.requires(...params)`                           | Fail unless the listed parameters resolved to a value.                                            |
| `.retry(times, delayMs?)`                        | Retry the body on failure.                                                                        |
| `.timeout(ms)`                                   | Fail the body if it runs longer than `ms` (per attempt).                                          |
| `.lock((s) => s.lockKey(...).withTtl(...))`      | Hold a cross-run lock while running; a second run wanting the key fails. See below.               |
| `.waitsFor((s) => s.on(externalSignal(...)))`    | Gate (no body): suspend the run until an external event; resume later. See below.                 |
| `.proceedAfterFailure()`                         | Keep the build going if this target fails.                                                        |
| `.always()`                                      | Run even after the build failed (cleanup/teardown).                                               |
| `.unlisted()`                                    | Hide from `--list`/`--help`; still runnable by name.                                              |
| `.validateBefore(...v)` / `.validateAfter(...v)` | Run `Validation` checks around the body; a throw fails the target.                                |
| `.recoverWith(...r)` / `.recoverAttempts(n)`     | Run `Remediation`s if the body fails (self-healing); re-run when one asks to. See AI section.     |
| `.partOf(group)`                                 | Join a parallel batch (see `group()`).                                                            |
| `.produces(...p)` / `.consumes(...t)`            | Declare and consume artifact paths.                                                               |

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
});
```

**Cancellation.** When the run is cancelled, `ctx.signal` fires and any plain
`` $`…` `` in the body is terminated with `SIGTERM` automatically (the run's
signal is the shell's ambient signal). Pass `ctx.signal` to `.signal(...)` to
cancel a command explicitly; it composes with `.killAfter(ms)`. Cancel a run
programmatically with `execute(build, root, { signal })`. A body that ignores
its signal and never shells out runs to completion.

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
- The run record holds status, the graph shape, resolved **non-secret**
  parameters, and per-target status/timing/metadata. Inspect it from the CLI
  with `zuke runs list [--status <s>] [--target <t>] [--since <iso>]` (newest
  first) and `zuke runs show <id>` (`--json` on both), or programmatically with
  `store.listRuns({ status?, target?, since? })` and `store.getRun(id)`.
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

- Triggers: `externalSignal(name)` (payload read via `ctx.signals`) and
  `resumeWhen(fn, { interval? })` (async predicate, re-checked on resume).
- Needs a state store (a build with `.waitsFor()` enables `.zuke/runs` by
  default). A resume is a fresh process, so **only `ctx.state`/`ctx.signals`
  cross the boundary**. See `docs/orchestration.md`.
- Continue a suspended run with
  `zuke resume <id> --signal <name> [--data <json>]` (or
  `zuke resume --check [<id>]` for predicate waits/timeouts). Resumption is
  **exactly-once** (concurrent resumers get `AlreadyResumedError`) and re-runs
  only the not-yet-succeeded targets; `--force-graph` overrides a changed graph.

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

// One tool:
bin = target().executes(async () =>
  await ToolTasks.install((s) =>
    s.name("shellcheck").version("0.10.0" /* …checksum */)
  )
);

// Many at once:
tools = toolchain((t) => t.add(/* … */).add(/* … */));
```

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
./zuke runs list [--status s] # list persisted runs (also --target, --since, --json)
./zuke runs show <id>         # one run's full per-target status (+ --json)
./zuke mcp [--allow-run]      # serve the build over MCP for an AI client
```

**Caching:** a target with `.inputs(...)`/`.outputs(...)` is incremental
(skipped and reported `cached` when inputs are unchanged and outputs exist). Add
a **remote store** to share results across machines — a fresh CI checkout or a
teammate's clone restores outputs instead of rebuilding; `--no-remote-cache`
uses the local cache only. `--affected` limits a run to targets touched since a
git base (great for CI job fan-out).
