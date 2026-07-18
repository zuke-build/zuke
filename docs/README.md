# Zuke documentation

- [Getting started](./getting-started.md) — install, scaffold, the launcher, and
  a first build.
- [Core concepts](./concepts.md) — the build/target/graph model and execution
  semantics.
- [Authoring API](./authoring.md) — `target()`, `Build`, `run()`, and gotchas.
- [Run context & cancellation](./run-context.md) — the `TargetContext` a body
  receives (`runId`, `signal`, `state`), and cancelling a run.
- [Parameters](./parameters.md) — typed build inputs from flags, env, or
  defaults.
- [Secrets](./secrets.md) — source secret values from a manager with
  `.from(...)`, and the guaranteed redaction of every secret from output.
- [Service targets](./services.md) — `service()` for long-lived processes (a dev
  server, a database) kept running while dependents execute, then torn down.
- [Caching](./caching.md) — the incremental build cache, the remote
  (cross-machine) cache, and the AI response cache.
- [Durable run state](./state.md) — persist a run's status and per-target
  metadata to a pluggable store, and read it back after the process exits.
- [Cross-run locks](./locks.md) — `.lock()` claims an exclusive resource across
  runs and machines, with a TTL backstop and typed conflicts.
- [Orchestration: waits & suspend/resume](./orchestration.md) — `.waitsFor()`
  suspends a run until an external event, to be resumed later.
- [State HTTP API](./state-api.md) — the REST contract for hosting a production
  state backend.
- [Shell wrapper (`$`)](./shell.md) — ergonomic, injection-safe process
  execution.
- [Paths (`absolutePath`)](./paths.md) — the fluent path type.
- [Tools](./tools.md) — the typed tool-wrapper packages and their tasks.
- [Installing tools](./installing-tools.md) — fetch pinned, checksum-verified
  CLIs from a build with `installRelease()` and `toolchain()`.
- [Extending Zuke](./extending.md) — the plugin contract: lifecycle plugins,
  tool wrappers, and reusable target bundles.
- [Observability (OpenTelemetry)](./observability.md) — `@zuke/otel` exports run
  and target spans plus counters as OTLP/HTTP JSON, with trace continuity across
  suspend/resume.
- [MCP server](./mcp.md) — `zuke mcp` exposes the build to AI agents as typed
  tools over the Model Context Protocol.
- [AI review](./ai-review.md) — model-assessed review gates as build
  validations.
- [Self-healing builds](./self-healing.md) — hand a failure to an AI fixer that
  re-runs the command to verify.
- [Using Zuke in a Node/npm project](./node-projects.md) — drive a Node build
  with Deno.
- [CLI reference](./cli.md) — commands and flags.
- [Programmatic API](./programmatic-api.md) — drive Zuke from your own code.
