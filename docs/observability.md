# Observability (OpenTelemetry)

`@zuke/otel` exports a build's run as [OpenTelemetry](https://opentelemetry.io/)
traces and metrics, so a CI pipeline shows up in your existing Grafana / Tempo /
Prometheus stack next to everything else. It is a [plugin](./extending.md):
register it on a run and every run/target transition is shipped to your
collector as **OTLP/HTTP JSON**. Core stays OpenTelemetry-free — the package has
**no runtime dependencies** and hand-rolls the OTLP payloads.

```ts
import { run } from "jsr:@zuke/core";
import { otel } from "jsr:@zuke/otel";

await run(MyBuild, {
  plugins: [
    otel((s) =>
      s.endpoint("http://localhost:4318")
        .serviceName("my-build")
        .header("authorization", "Bearer …")
    ),
  ],
});
```

## What it exports

The plugin observes each run-level transition (via
[`onRunStateChange`](./extending.md), which delivers the durable
[`RunRecord`](./state.md)) and emits:

| Signal               | When                                     | Shape                                                                          |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| **trace**            | the run settles                          | a run span (`createdAt` → `updatedAt`) with one child span per executed target |
| `zuke.run.started`   | a *fresh* run begins                     | counter, tagged `zuke.build` / `zuke.root_target`                              |
| `zuke.run.suspended` | the run parks at a `.waitsFor(...)` gate | counter per waiting target, tagged with its `trigger`                          |
| `zuke.runs`          | the run settles                          | counter, tagged `outcome` = `succeeded` / `failed` / `cancelled`               |

The **run span** carries `zuke.run.id`, `zuke.build`, `zuke.root_target`,
`zuke.actor`, and `zuke.run.status`. Each **target span** carries `zuke.target`
and `zuke.target.status`; a failed target's span is marked `error` with its
(redacted) message, so a broken build is a red span, not just a log line. Metric
data points are OTLP delta `Sum`s (`aggregationTemporality = 1`).

Only targets that actually executed (they have a start timestamp) get a span; a
skipped or never-reached target is omitted.

## Trace continuity across suspend/resume

A run that [suspends at a `.waitsFor(...)` gate](./orchestration.md) and resumes
later — often in a **different process**, minutes or days on — still shows up as
**one trace**. Two things make that work with no cross-process handoff:

- The trace id is `SHA-256(runId)` truncated to 16 bytes, and each target's span
  id is a stable hash of `(runId, target)`. Every process for the run derives
  the same ids from the same run id.
- The durable run record accumulates every target's **absolute** timestamps —
  including the ones that ran before the suspend. So the finishing process
  exports a single, complete, gap-spanning trace: the pre-suspend `deploy` span
  and the post-resume `promote` span sit under one run span, with the wait
  visible as the gap between them.

The run's `zuke.run.suspended` counter (emitted when it parks) and the terminal
`zuke.runs{outcome}` counter bracket that wait for dashboards.

## Configuration

Configure through the settings lambda, or lean entirely on the standard `OTEL_*`
environment variables the OpenTelemetry ecosystem already uses:

| Setter                          | Environment fallback                  |
| ------------------------------- | ------------------------------------- |
| `.endpoint(url)`                | `OTEL_EXPORTER_OTLP_ENDPOINT`         |
| `.tracesEndpoint(url)`          | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  |
| `.metricsEndpoint(url)`         | `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` |
| `.serviceName(name)`            | `OTEL_SERVICE_NAME` (else `zuke`)     |
| `.header(k, v)` / `.headers(m)` | `OTEL_EXPORTER_OTLP_HEADERS`          |
| `.resourceAttribute(k, v)`      | `OTEL_RESOURCE_ATTRIBUTES`            |
| `.timeout("5s")`                | — (default 10s)                       |

An explicit setter wins over the environment. A base `.endpoint(...)` has
`/v1/traces` and `/v1/metrics` appended; a per-signal endpoint is used verbatim
(the OTLP convention). Because the whole config can come from the environment,
the same registration works locally and in CI:

```ts
// Reads OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_SERVICE_NAME / OTEL_EXPORTER_OTLP_HEADERS.
await run(MyBuild, { plugins: [otel()] });
```

**With no endpoint configured by either route, the plugin is inert** — it
registers but does nothing — so it is safe to add unconditionally and light up
only where a collector is configured.

## Requirements & guarantees

- **A [state store](./state.md) is required.** The plugin's records come from
  Zuke's durable run state, so a plain store-less build exports nothing. Turn
  state on with `--state`, `ZUKE_STATE_DIR` / `ZUKE_STATE_URL`, or a
  `stateStore()` override; a build that already uses locks, waits, or
  compensations enables it automatically.
- **Export is best-effort.** A collector that is down, slow, or rejecting is
  never allowed to fail — or stall, beyond the timeout — the build. Export
  failures are swallowed, the OpenTelemetry-SDK convention.
- **The record is secret-free.** It is the same redacted projection
  `zuke runs show` prints: [`secret()`](./secrets.md) parameters are omitted,
  and errors and state metadata are run through the redactor before they reach
  the plugin. It is safe to ship to a collector.

See the [`@zuke/otel` README](../packages/otel/README.md) for the generated API
reference.
