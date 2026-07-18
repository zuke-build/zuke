/**
 * `@zuke/otel` — an OpenTelemetry (OTLP/HTTP **JSON**) export plugin for Zuke
 * builds. Register {@link otel} on a run and every run/target transition is
 * exported to a collector: a run span with one child span per target, plus
 * `zuke.run.started` / `zuke.run.suspended` / `zuke.runs` counters. The trace id
 * is derived from the run id, so a run that suspends in one process and resumes
 * in another lands its spans under a single trace with no handoff.
 *
 * ```ts
 * import { run } from "jsr:@zuke/core";
 * import { otel } from "jsr:@zuke/otel";
 *
 * await run(MyBuild, {
 *   plugins: [otel((s) => s.endpoint("http://localhost:4318").serviceName("ci"))],
 * });
 * ```
 *
 * Configuration falls back to the standard `OTEL_EXPORTER_OTLP_ENDPOINT`,
 * `OTEL_SERVICE_NAME`, and `OTEL_EXPORTER_OTLP_HEADERS` environment variables;
 * with no endpoint the plugin is inert. Core stays OpenTelemetry-free — this
 * package has no runtime dependencies and hand-rolls the OTLP JSON.
 *
 * @module
 */

export { otel } from "./src/plugin.ts";
export { OtelSettings } from "./src/settings.ts";
