/**
 * The fluent {@link OtelSettings} the {@link "./plugin.ts".otel} factory is
 * configured with, and {@link resolveOtel}, which folds those settings together
 * with the standard `OTEL_*` environment variables into a {@link ResolvedOtel}
 * the exporter can use — or `null` when no endpoint is configured, which makes
 * the plugin inert (safe to always register).
 *
 * Precedence follows the OpenTelemetry spec's spirit: an explicit setter wins
 * over the environment, and a per-signal endpoint (`.tracesEndpoint(...)` /
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) wins over the base endpoint with the
 * signal path appended.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { OtlpResource } from "./otlp.ts";

/** The plugin package version, stamped as the OTLP instrumentation-scope version. */
export const SCOPE_VERSION = "0.0.0";

/**
 * Configuration for the OTLP exporter, set through a lambda passed to
 * {@link "./plugin.ts".otel}. Every setter returns `this` so calls chain, and
 * each value falls back to the matching `OTEL_*` environment variable when left
 * unset (see {@link resolveOtel}).
 */
export class OtelSettings {
  /** The base OTLP/HTTP endpoint (e.g. `http://localhost:4318`). */
  endpoint_?: string;
  /** A full endpoint for the trace signal, overriding {@link endpoint_} + `/v1/traces`. */
  tracesEndpoint_?: string;
  /** A full endpoint for the metric signal, overriding {@link endpoint_} + `/v1/metrics`. */
  metricsEndpoint_?: string;
  /** The `service.name` resource attribute. */
  serviceName_?: string;
  /** Extra HTTP headers sent on every export (e.g. an auth token). */
  headers_: Record<string, string> = {};
  /** Extra OTLP resource attributes (e.g. `deployment.environment`). */
  resourceAttributes_: Record<string, string> = {};
  /** Per-request timeout in milliseconds (default 10s). */
  timeoutMs_ = 10_000;

  /** Set the base OTLP/HTTP endpoint; `/v1/traces` and `/v1/metrics` are appended. */
  endpoint(url: string): this {
    this.endpoint_ = url;
    return this;
  }

  /** Set a full endpoint URL for the trace signal (no path is appended). */
  tracesEndpoint(url: string): this {
    this.tracesEndpoint_ = url;
    return this;
  }

  /** Set a full endpoint URL for the metric signal (no path is appended). */
  metricsEndpoint(url: string): this {
    this.metricsEndpoint_ = url;
    return this;
  }

  /** Set the `service.name` reported to the collector. */
  serviceName(name: string): this {
    this.serviceName_ = name;
    return this;
  }

  /** Add one HTTP header to every export request. */
  header(name: string, value: string): this {
    this.headers_[name] = value;
    return this;
  }

  /** Merge a map of HTTP headers into the export requests. */
  headers(map: Record<string, string>): this {
    Object.assign(this.headers_, map);
    return this;
  }

  /** Add one OTLP resource attribute. */
  resourceAttribute(name: string, value: string): this {
    this.resourceAttributes_[name] = value;
    return this;
  }

  /** Merge a map of OTLP resource attributes. */
  resourceAttributes(map: Record<string, string>): this {
    Object.assign(this.resourceAttributes_, map);
    return this;
  }

  /** Set the per-request timeout (a duration string like `"5s"`). */
  timeout(duration: string): this {
    this.timeoutMs_ = parseDuration(duration);
    return this;
  }
}

/** A fully resolved exporter configuration (settings merged with the environment). */
export interface ResolvedOtel {
  /** The URL the trace signal is POSTed to, or `undefined` to skip traces. */
  tracesUrl: string | undefined;
  /** The URL the metric signal is POSTed to, or `undefined` to skip metrics. */
  metricsUrl: string | undefined;
  /** The HTTP headers sent on every export. */
  headers: Record<string, string>;
  /** The per-request timeout in milliseconds. */
  timeoutMs: number;
  /** The OTLP resource/scope identity for every export. */
  resource: OtlpResource;
}

/** Join a base endpoint and a signal path, tolerating a trailing slash. */
function joinEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Normalise a blank or whitespace-only endpoint value to `undefined` (unset). */
function cleanEndpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Parse an `OTEL_EXPORTER_OTLP_HEADERS`-style value (`k1=v1,k2=v2`) into a map.
 * Whitespace around keys/values is trimmed; malformed entries are skipped.
 */
export function parseHeaderList(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key !== "") out[key] = val;
  }
  return out;
}

/**
 * Resolve {@link OtelSettings} plus the environment into a {@link ResolvedOtel},
 * or `null` when no endpoint is configured at all (neither an explicit setter
 * nor `OTEL_EXPORTER_OTLP_ENDPOINT` / a per-signal endpoint variable) — in which
 * case the plugin does nothing. A blank or whitespace-only endpoint counts as
 * unset (so `OTEL_EXPORTER_OTLP_ENDPOINT=` disables rather than resolving to a
 * relative URL), and the two signals resolve **independently**: one per-signal
 * endpoint on its own enables just that signal, and only that one is exported.
 *
 * `readEnv` is the environment seam (defaults to `Deno.env.get`), kept injectable
 * so resolution is unit-testable without touching the process environment.
 */
export function resolveOtel(
  settings: OtelSettings,
  readEnv: (name: string) => string | undefined,
): ResolvedOtel | null {
  const base = cleanEndpoint(
    settings.endpoint_ ?? readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  );
  const tracesRaw = cleanEndpoint(
    settings.tracesEndpoint_ ?? readEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
  );
  const metricsRaw = cleanEndpoint(
    settings.metricsEndpoint_ ?? readEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
  );

  const tracesUrl = tracesRaw ??
    (base !== undefined ? joinEndpoint(base, "/v1/traces") : undefined);
  const metricsUrl = metricsRaw ??
    (base !== undefined ? joinEndpoint(base, "/v1/metrics") : undefined);
  // Inert only when neither signal has an endpoint; one alone enables that one.
  if (tracesUrl === undefined && metricsUrl === undefined) return null;

  const envHeaders = readEnv("OTEL_EXPORTER_OTLP_HEADERS");
  const headers: Record<string, string> = {
    ...(envHeaders !== undefined ? parseHeaderList(envHeaders) : {}),
    ...settings.headers_, // an explicit setter overrides the environment
  };

  const envAttrs = readEnv("OTEL_RESOURCE_ATTRIBUTES");
  const attributes: Record<string, string> = {
    ...(envAttrs !== undefined ? parseHeaderList(envAttrs) : {}),
    ...settings.resourceAttributes_,
  };

  const serviceName = settings.serviceName_ ?? readEnv("OTEL_SERVICE_NAME") ??
    "zuke";

  return {
    tracesUrl,
    metricsUrl,
    headers,
    timeoutMs: settings.timeoutMs_,
    resource: { serviceName, attributes, scopeVersion: SCOPE_VERSION },
  };
}
