# @zuke/otel

An [OpenTelemetry](https://opentelemetry.io/) export plugin for
[Zuke](https://github.com/zuke-build/zuke#readme) builds. Register it on a run
and every run/target transition is exported to your collector as **OTLP/HTTP
JSON** — a run span with one child span per target, plus run counters. The trace
id is derived from the run id, so a run that **suspends in one process and
resumes in another lands its spans under a single trace**, with no handoff.

No runtime dependencies: the OTLP JSON is hand-rolled, and `@zuke/core` stays
OpenTelemetry-free.

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

Registered on a run with a durable state store, the plugin observes each
run-level transition and emits:

| Signal               | When                                     | Shape                                                                          |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| **trace**            | the run settles                          | a run span (`createdAt` → `updatedAt`) with one child span per executed target |
| `zuke.run.started`   | a _fresh_ run begins                     | counter, tagged `zuke.build` / `zuke.root_target`                              |
| `zuke.run.suspended` | the run parks at a `.waitsFor(...)` gate | counter per waiting target, tagged with its `trigger`                          |
| `zuke.runs`          | the run settles                          | counter, tagged `outcome` = `succeeded` / `failed` / `cancelled`               |

A target span carries `zuke.target` / `zuke.target.status`, and a failed
target's span is marked `error` with its (redacted) message. The run span
carries `zuke.build`, `zuke.root_target`, `zuke.actor`, and `zuke.run.status`.

## Trace continuity across resume

The trace id is `SHA-256(runId)` truncated to 16 bytes, and each target's span
id is a stable hash of `(runId, target)`. The durable run record accumulates
every target's absolute timestamps — including targets that ran **before** a
suspend — so the finishing process exports one complete, gap-spanning trace on
its own. Because the id is derived, not handed off, that trace is exactly the
one every process for the run would produce.

## Configuration

Configure through the settings lambda, or leave it to the standard `OTEL_*`
environment variables:

| Setter                          | Environment fallback                  |
| ------------------------------- | ------------------------------------- |
| `.endpoint(url)`                | `OTEL_EXPORTER_OTLP_ENDPOINT`         |
| `.tracesEndpoint(url)`          | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  |
| `.metricsEndpoint(url)`         | `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` |
| `.serviceName(name)`            | `OTEL_SERVICE_NAME` (else `zuke`)     |
| `.header(k, v)` / `.headers(m)` | `OTEL_EXPORTER_OTLP_HEADERS`          |
| `.resourceAttribute(k, v)`      | `OTEL_RESOURCE_ATTRIBUTES`            |
| `.timeout("5s")`                | — (default 10s)                       |

An explicit setter wins over the environment; a base `.endpoint(...)` has
`/v1/traces` and `/v1/metrics` appended, while a per-signal endpoint is used
verbatim. **With no endpoint configured by either route, the plugin is inert**,
so it is safe to register unconditionally.

## Notes

- **A state store is required.** The plugin's records come from Zuke's durable
  run state, so a plain store-less build exports nothing. Enable state with
  `--state`, `ZUKE_STATE_DIR` / `ZUKE_STATE_URL`, or a `stateStore()` override;
  a build that uses locks/waits/compensations turns it on automatically.
- **Export is best-effort.** A collector that is down, slow, or rejecting is
  never allowed to fail (or stall, beyond the timeout) the build — telemetry
  failures are swallowed, the OpenTelemetry-SDK convention.
- **The record is secret-free.** It is the same redacted projection
  `zuke runs show` prints — `secret()` parameters are omitted and errors/state
  are run through the redactor — so it is safe to export.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/otel` — an OpenTelemetry (OTLP/HTTP JSON) export plugin for Zuke
builds. Register {@link otel} on a run and every run/target transition is
exported to a collector: a run span with one child span per target, plus
`zuke.run.started` / `zuke.run.suspended` / `zuke.runs` counters. The trace id
is derived from the run id, so a run that suspends in one process and resumes
in another lands its spans under a single trace with no handoff.

```ts
import { run } from "jsr:@zuke/core";
import { otel } from "jsr:@zuke/otel";

await run(MyBuild, {
  plugins: [otel((s) => s.endpoint("http://localhost:4318").serviceName("ci"))],
});
```

Configuration falls back to the standard `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_SERVICE_NAME`, and `OTEL_EXPORTER_OTLP_HEADERS` environment variables;
with no endpoint the plugin is inert. Core stays OpenTelemetry-free — this
package has no runtime dependencies and hand-rolls the OTLP JSON.
@module

function otel(configure?: Configure<OtelSettings>): Plugin
  Create the OpenTelemetry export plugin. Register it on a run and every
  run/target transition is exported as OTLP/HTTP JSON:

  ```ts
  import { run } from "jsr:@zuke/core";
  import { otel } from "jsr:@zuke/otel";

  await run(MyBuild, {
    plugins: [otel((s) => s.endpoint("http://localhost:4318").serviceName("ci"))],
  });
  ```

  With no argument it reads the standard `OTEL_EXPORTER_OTLP_ENDPOINT` /
  `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_HEADERS` environment variables. If
  no endpoint is configured by either route the plugin is inert, so it is safe
  to register unconditionally. Telemetry needs a state store (the plugin's
  records come from durable run state); a store-less build exports nothing.

class OtelSettings
  Configuration for the OTLP exporter, set through a lambda passed to
  {@link "./plugin.ts".otel}. Every setter returns `this` so calls chain, and
  each value falls back to the matching `OTEL_*` environment variable when left
  unset (see {@link resolveOtel}).

  endpoint_?: string
    The base OTLP/HTTP endpoint (e.g. `http://localhost:4318`).
  tracesEndpoint_?: string
    A full endpoint for the trace signal, overriding {@link endpoint_} + `/v1/traces`.
  metricsEndpoint_?: string
    A full endpoint for the metric signal, overriding {@link endpoint_} + `/v1/metrics`.
  serviceName_?: string
    The `service.name` resource attribute.
  headers_: Record<string, string>
    Extra HTTP headers sent on every export (e.g. an auth token).
  resourceAttributes_: Record<string, string>
    Extra OTLP resource attributes (e.g. `deployment.environment`).
  timeoutMs_: number
    Per-request timeout in milliseconds (default 10s).
  endpoint(url: string): this
    Set the base OTLP/HTTP endpoint; `/v1/traces` and `/v1/metrics` are appended.
  tracesEndpoint(url: string): this
    Set a full endpoint URL for the trace signal (no path is appended).
  metricsEndpoint(url: string): this
    Set a full endpoint URL for the metric signal (no path is appended).
  serviceName(name: string): this
    Set the `service.name` reported to the collector.
  header(name: string, value: string): this
    Add one HTTP header to every export request.
  headers(map: Record<string, string>): this
    Merge a map of HTTP headers into the export requests.
  resourceAttribute(name: string, value: string): this
    Add one OTLP resource attribute.
  resourceAttributes(map: Record<string, string>): this
    Merge a map of OTLP resource attributes.
  timeout(duration: string): this
    Set the per-request timeout (a duration string like `"5s"`).
````

</details>

<!-- ZUKE:API:END -->
