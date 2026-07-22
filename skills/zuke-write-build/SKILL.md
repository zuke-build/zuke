---
name: zuke-write-build
description: Write or edit a Zuke build (zuke.ts) — the code-first, strongly-typed build system for Deno/TypeScript. Use when adding or changing targets, wiring dependencies, calling a tool wrapper (DenoTasks, NpmTasks, DockerTasks, ...), generating CI, or authoring/refactoring a zuke.ts build file. For first-time project scaffolding, use the zuke-setup skill instead.
---

# Write or edit a Zuke build

A build is a class that **extends `Build`**. Each **target is a class field**
created with `target()` and made runnable with `await run(MyBuild)` at the
bottom of `zuke.ts` (no `import.meta.main` guard — `run` no-ops on import).

<!-- check -->

```ts
import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class CI extends Build {
  lint = target()
    .description("Lint sources")
    .executes(async () => {
      await DenoTasks.lint();
    });

  test = target()
    .description("Type-check and test")
    .dependsOn(this.lint)
    .executes(async () => {
      await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
    });

  // A field named `default` runs when no target is named on the CLI.
  default = target().dependsOn(this.test).executes(() => {});
}

await run(CI);
```

## Non-negotiable rules

1. **Dependencies are `this.<field>` references, never strings.**
   `.dependsOn(this.lint)`, not `.dependsOn("lint")` — so renames and typos are
   compile-time errors.
2. **A target may only depend on siblings declared _above_ it.** Class fields
   initialise top-to-bottom; a forward reference is `undefined` and is reported
   as an error (TypeScript also flags it, `TS2729`). Order fields so
   dependencies come first.
3. **Inside a target body, never guess the API or shell out by hand.** Whatever
   runs in an `.executes(...)` body drives an external tool through its
   namespaced `*Tasks` object, configured with a **settings lambda** that mirrors
   the real CLI's flags — `DenoTasks`, `NpmTasks`, `DockerTasks`, `GitTasks`, and
   30+ more — never a raw `Deno.Command` or shell string. Reach for
   `jsr:@zuke/cmd` (`CmdTasks.exec`) or the `$` shell from `jsr:@zuke/core/shell`
   only when no typed wrapper exists. (If a build delegates its side effects to
   your own tested modules behind injected clients, the wrapper rule still
   governs whatever those modules run in the target body.)
4. **A body is required.** Set `.executes(...)`; it may be sync or async.

## Find the exact signature first

Before calling any task or settings method, confirm the real shape:

- **Whole surface:** read `llms-full.txt` at the repo root (index: `llms.txt`).
- **One package:** `deno doc jsr:@zuke/<package>` (e.g.
  `deno doc jsr:@zuke/deno`).
- A quick map of the most common methods and task objects is in
  [`references/cheatsheet.md`](references/cheatsheet.md) next to this file —
  read it when wiring targets, then verify specifics against the sources above.

## Workflow for a change

1. Read the existing `zuke.ts` to learn the targets already declared and their
   order.
2. Identify the tool you need and look up its `*Tasks` object and settings
   methods (cheatsheet → `deno doc` / `llms-full.txt`).
3. Add or edit the target field. Place it **below** every target it depends on.
   Wire dependencies with `this.<field>`.
4. Validate: `./zuke --list` shows it; `./zuke <target> --dry-run` previews the
   plan; `./zuke <target>` runs it.

## Common building blocks (see the cheatsheet for details)

- **Parallel batches:** `group()` + `.partOf(this.group)` run members
  concurrently; depend on the group to wait for all of them.
- **Reusable bundles:** a _component_ is a function returning related targets;
  assign it to a field and reference members as `this.release.publish`.
- **Long-lived processes:** `service()` models a process that must stay _running
  while dependents execute_ (dev server, database, mock API). Declared and
  depended on like a target, but with a `.start(...)` / `.readyWhen(...)`
  lifecycle instead of `.executes(...)`; the executor starts it, waits until
  ready, then stops it in a `finally` so it never leaks. See the cheatsheet.
- **Target context & cancellation:** a body may take a context —
  `.executes((ctx) => …)` — with `ctx.runId`, `ctx.target`, `ctx.signal` (an
  `AbortSignal` fired when the run is cancelled; a plain `` $`…` `` in the body
  is `SIGTERM`'d automatically), `ctx.state`, and `ctx.dryRun`. Zero-argument
  bodies keep working unchanged. Cancel a run programmatically by passing
  `{ signal }` to `execute`. See the cheatsheet.
- **Caching:** `.inputs(...)` / `.outputs(...)` make a target incremental. Add a
  **remote store** to share results across machines (fresh CI, teammates);
  `--affected` runs only targets changed since a git base; `--no-cache` /
  `--no-remote-cache` bypass them.
- **Durable run state:** persist a run's status and per-target metadata to a
  pluggable `StateStore` so it survives the process — turn it on with `--state`,
  `ZUKE_STATE_DIR` / `ZUKE_STATE_URL`, or `override stateStore()`. In a body,
  `ctx.state.set({ … })` / `ctx.state.get()` records per-target metadata (JSON,
  **never secrets** — secret parameters and redacted values are excluded).
  Inspect persisted runs afterwards with `zuke runs list` (filter by
  `--status`/`--target`/`--since`/`--limit`) and `zuke runs show <id>` (`--json`
  on both). Prune old ones with `zuke runs prune --keep <age> --keep-last <n>`
  (only terminal runs; never suspended/running).
  See the cheatsheet.
- **Cross-run locks:** `.lock((s) => s.lockKey(...).withTtl("4h"))` — a settings
  lambda — gives a target an exclusive claim across runs/machines; a second run
  wanting the same key fails with a `LockConflictError` naming the holder. The
  lambda runs after params resolve, so the key can read `this.<param>.value`.
  The lock releases when the target settles and expires after the TTL if the
  holder is killed. Needs a state store (a build with `.lock()` enables the
  filesystem store by default). See the cheatsheet.
- **External-event waits:**
  `.waitsFor((s) => s.on(externalSignal("approved")).timeout("72h"))` makes a
  target a **gate** with no body: the run proceeds past it only when the trigger
  is satisfied, otherwise it **suspends** (state saved, exits 0) to be resumed
  later in a fresh process. Triggers: `externalSignal(name)` (payload read via
  `ctx.signals`) and `resumeWhen(predicate)`. Continue it with
  `zuke resume <id> --signal <name> [--data <json>]` (or `--check` for predicate
  waits/timeouts) — exactly-once, re-running only the not-yet-succeeded targets.
  Needs a state store. See the cheatsheet / `docs/orchestration.md`.
- **Cancellation & compensation:** `.onCancel(() => this.rollback)` registers a
  compensation that runs **iff this target succeeded** when the run is later
  cancelled — compensations run in reverse order, and the compensation body's
  `ctx.state` exposes the original target's persisted metadata (so a rollback
  reads what the deploy recorded). Cancel with `zuke cancel <id>` (or Ctrl-C, or
  the MCP `cancel_run` tool). Idempotent; a timed-out wait can route its
  `onTimeout` here (`"cancel-run"` or a named target). Needs a state store. See
  `docs/orchestration.md`.
- **Fan-out over a list:**
  `.forEach(() => this.repos.value, (repo) => ({ checks: target()…, deploy: target()… }), (s) => s.concurrency(3).continueOnItemFailure())`
  runs the same pipeline over a runtime list — items concurrent, each item's
  stages sequential. Sub-targets are materialised at run time
  (`parent[item].stage`), each a first-class row in the summary and the run
  record; `continueOnItemFailure()` isolates a failed item. An `.onCancel(...)`
  on a fan-out stage runs per item on cancel (item-scoped `ctx.state`, reverse
  order). See `docs/orchestration.md`.
- **Typed inputs:** `parameter("...")` (with `.number()` / `.boolean()` /
  `.options(...)` / `.secret()` / `.required()`), read as `this.x.value`, gated
  with `.requires(this.x)`. `.array()` composes and comes **last**:
  `.options(...).array()` validates each element, `.number().array()` →
  `number[]`, and a required list is `.required().array()` (required before
  array — `.array().required()` does not typecheck).
- **Secrets from a manager:** `parameter(...).secret().from(source)` sources a
  value at run time (e.g. `execSecret(...)` shelling out to a secret CLI) and
  **redacts** it from all of Zuke's output. See the cheatsheet.
- **Provisioning tools:** `ToolTasks.install((s) => …)` / `toolchain((t) => …)`
  fetch pinned, checksum-verified release binaries so a build is hermetic, and
  `t.npm({ name, version, bin? })` / `ToolTasks.npm(...)` provision a
  version-pinned, cached npm-registry package (needs `npm` on `PATH`); hand the
  returned path to a wrapper's `.toolPath(...)`. In a Node monorepo, resolve a
  wrapper's binary from `node_modules/.bin` npx-style instead —
  `.fromNodeModules()` on the settings (or `ZUKE_TOOL_RESOLUTION=node_modules`
  repo-wide) walks up for the local shim and falls back to PATH; `.fromPath()`
  forces PATH and an explicit `.toolPath(...)` always wins. See the cheatsheet /
  `docs/tools.md`.
- **Code-first CI:** `cicd({ provider: "github" })` generates and verifies the
  workflow YAML from the build.
- **Operate the build from an agent:** `zuke mcp` serves the build over MCP so
  an AI client can list, inspect, and (with `--allow-run`) run targets — on
  stdio, or over HTTP with `--http <host:port>` (loopback by default; a
  non-loopback bind needs a `ZUKE_MCP_TOKEN` bearer token). With a state store
  it also exposes `list_runs`/`show_run` (+ `signal_run`/`resume_check`). Tier
  access with `--allow-run=<globs>` (allow-list), `--protect <globs>` +
  `ZUKE_OPERATOR_TOKEN`, and `--confirm-destructive`; mark inspect-only targets
  `.readOnly()`. Mutating/denied calls are audited (`zuke runs show mcp-audit`).
  A **registry-backed** server (`zuke register` then `zuke mcp --registry`)
  instead serves every registered pipeline live, each as a
  `run:<buildId>:<target>` tool that takes the build's declared parameters
  (secrets excluded, validated, forwarded to the spawn) — see the cheatsheet.
  For a shared, multi-user endpoint, `override mcpIdentity()` resolves a
  **trusted** caller per request from an authenticating proxy's header (it
  overrides the client-reported actor and flows to the audit trail, run records,
  and lock holders; a throwing hook rejects the request).
- **AI review & self-healing (`@zuke/ai`):** gate a target on a structured LLM
  review of the diff (`securityReviewer(...)` etc. via `.validateBefore`), or
  attach `aiFixer(...)` with `.recoverWith(...)` so a failing target is
  diagnosed and (opt-in) auto-fixed, with a committable PR suggestion. Override
  `recoverWith()` on the build to apply one fixer to every target. See the
  cheatsheet's AI section.
- **Wait on an external GitHub workflow (`@zuke/gh`):** in a `.waitsFor(...)`
  gate, `s.on(githubWorkflow((g) => g.repo("o/r").workflow("e2e.yml")))`
  dispatches a workflow in another repo and suspends until it finishes; read the
  per-job result with `readWorkflowResult(ctx.stateOf("<gate>"))`. Correlates by
  a `run-name:` marker by default, or `.correlate("created-window")` for a
  workflow you can't modify; fails fast (`.discoveryTimeout(...)`) if the run
  never correlates. The **dispatched** workflow has a contract: declare the
  marker input (`zuke_marker`, or rename via `.markerInput(...)`), echo it as its
  _entire_ `run-name:` (equality, not substring), and receive any of its
  `required: true` inputs via `.inputs(...)` — see the cheatsheet's
  receiving-workflow contract. Triggers are extensible — write your own against
  the exported `WaitTrigger`/`WaitContext`.
- **OpenTelemetry export (`@zuke/otel`):** register `otel((s) => s.endpoint(…))`
  as a plugin (`run(MyBuild, { plugins: [otel(…)] })`) to ship run/target spans
  and `zuke.run.started` / `zuke.run.suspended` / `zuke.runs` counters as
  OTLP/HTTP JSON. Needs a state store; the trace id is derived from the run id,
  so a suspend/resume across processes is one trace. Config falls back to the
  standard `OTEL_*` env vars, and it is inert with no endpoint. Dependency-free.
