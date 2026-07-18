/**
 * The OTLP/HTTP JSON transport: POSTs a trace or metrics payload to a
 * collector. Kept behind the {@link OtlpTransport} interface so the plugin can
 * be driven by a capturing fake in tests, and built on the same `fetch` seam
 * the rest of Zuke's HTTP code uses (default: the global `fetch`).
 *
 * Export is **best-effort**: a dead collector, a timeout, or a non-2xx response
 * is swallowed, never surfaced as a build failure — telemetry must never break
 * the build (the OpenTelemetry SDK convention). The payload builders are pure
 * and independently tested, so silence here does not hide a shape bug.
 *
 * @module
 */

import type { OtlpMetricsPayload, OtlpTracePayload } from "./otlp.ts";

/**
 * Where the plugin sends OTLP payloads. The real implementation is
 * {@link OtlpHttpExporter}; tests pass a fake that records what it was handed.
 */
export interface OtlpTransport {
  /** Export a trace payload (best-effort). */
  traces(payload: OtlpTracePayload): Promise<void>;
  /** Export a metrics payload (best-effort). */
  metrics(payload: OtlpMetricsPayload): Promise<void>;
}

/** Construction options for {@link OtlpHttpExporter}. */
export interface OtlpHttpExporterOptions {
  /** The URL trace payloads are POSTed to; `undefined` skips the trace signal. */
  tracesUrl: string | undefined;
  /** The URL metrics payloads are POSTed to; `undefined` skips the metric signal. */
  metricsUrl: string | undefined;
  /** HTTP headers added to every request (e.g. an auth token). */
  headers: Record<string, string>;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/** POSTs OTLP/HTTP JSON payloads to a collector, best-effort. */
export class OtlpHttpExporter implements OtlpTransport {
  readonly #tracesUrl: string | undefined;
  readonly #metricsUrl: string | undefined;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  /** Build the exporter from its resolved URLs, headers, timeout, and `fetch` seam. */
  constructor(options: OtlpHttpExporterOptions) {
    this.#tracesUrl = options.tracesUrl;
    this.#metricsUrl = options.metricsUrl;
    this.#headers = options.headers;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Export a trace payload to the traces endpoint (best-effort; skipped if none). */
  async traces(payload: OtlpTracePayload): Promise<void> {
    if (this.#tracesUrl === undefined) return;
    await this.#post(this.#tracesUrl, payload);
  }

  /** Export a metrics payload to the metrics endpoint (best-effort; skipped if none). */
  async metrics(payload: OtlpMetricsPayload): Promise<void> {
    if (this.#metricsUrl === undefined) return;
    await this.#post(this.#metricsUrl, payload);
  }

  /** POST one JSON payload, swallowing every failure (telemetry is best-effort). */
  async #post(url: string, payload: unknown): Promise<void> {
    // A manual controller + cleared timer (rather than `AbortSignal.timeout`) so
    // the timer is always released when the request settles — no pending timer
    // lingers past the export.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Consume the body so the connection is freed / no resource leaks in tests;
      // the response content is irrelevant to a best-effort export.
      await response.body?.cancel();
    } catch {
      // Best-effort: a collector that is down, slow, or rejecting must not fail
      // (or even slow, beyond the timeout) the build.
    } finally {
      clearTimeout(timer);
    }
  }
}
