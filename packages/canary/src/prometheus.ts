// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `prometheus(...)`: run an instant PromQL query and fail the canary when any
 * sample is out of bounds.
 *
 * @module
 */

import { parseDuration, redactUrls } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { boundsOf, checkThreshold } from "./threshold.ts";
import type { CanaryAnalysis } from "./types.ts";
import { messageOf } from "./message.ts";
import { requestSignal } from "./request.ts";

/** How long a query may take when no timeout is set. */
const DEFAULT_TIMEOUT = 30_000;

/** Settings for {@link prometheus}: where, what to ask, and the bounds. */
export class PrometheusSettings {
  /** What the query is called in a failure (set by {@link name}). */
  name_ = "prometheus query";
  /** The Prometheus base URL (set by {@link url}). */
  url_?: string;
  /** The PromQL expression (set by {@link query}). */
  query_?: string;
  /** The lowest acceptable sample (set by {@link min}). */
  min_?: number;
  /** The highest acceptable sample (set by {@link max}). */
  max_?: number;
  /** Request headers, such as `Authorization` (set by {@link header}). */
  readonly headers_: Record<string, string> = {};
  /** The request timeout in ms (set by {@link timeout}). */
  timeout_: number = DEFAULT_TIMEOUT;
  /** The `fetch` to use (set by {@link fetch}); the global one by default. */
  fetch_: typeof fetch = fetch;

  /** What to call the query when it fails. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** The Prometheus base URL, such as `https://prometheus.internal`. */
  url(url: string): this {
    this.url_ = url;
    return this;
  }

  /**
   * The PromQL expression. It must return a vector or a scalar; an empty
   * vector fails, so write `… or vector(0)` when no data means healthy.
   */
  query(promql: string): this {
    this.query_ = promql;
    return this;
  }

  /** Fail when any sample is below `value`. */
  min(value: number): this {
    this.min_ = value;
    return this;
  }

  /** Fail when any sample is above `value`. */
  max(value: number): this {
    this.max_ = value;
    return this;
  }

  /** Add a request header — `header("Authorization", `Bearer ${token}`)`. */
  header(name: string, value: string): this {
    this.headers_[name] = value;
    return this;
  }

  /** How long the query may take (`"10s"`, or ms; default 30 s). */
  timeout(duration: string | number): this {
    this.timeout_ = parseDuration(duration);
    return this;
  }

  /** The `fetch` to use — the seam a test answers queries through. */
  fetch(fetcher: typeof fetch): this {
    this.fetch_ = fetcher;
    return this;
  }
}

/**
 * An analysis that runs an instant PromQL query and fails the canary when any
 * sample is out of bounds:
 *
 * ```ts
 * prometheus((p) =>
 *   p.url("https://prometheus.internal")
 *     .query('sum(rate(http_errors_total{rev="canary"}[5m])) or vector(0)')
 *     .max(0.01)
 * )
 * ```
 *
 * The lambda runs on each check, so it may read resolved parameters. Failure
 * messages pass through the run's redactor, so a secret parameter in the URL
 * or the query is masked.
 */
export function prometheus(
  configure: Configure<PrometheusSettings>,
): CanaryAnalysis {
  return {
    name: "prometheus",
    async validate(context) {
      const settings = configure(new PrometheusSettings());
      const base = settings.url_;
      const promql = settings.query_;
      if (base === undefined || promql === undefined) {
        throw new Error(
          `prometheus "${settings.name_}" needs a URL and a query — call ` +
            `p.url(...).query(...).`,
        );
      }
      const bounds = boundsOf(settings);
      const fail = (detail: string): Error =>
        new Error(redactUrls(context.redact(detail)));
      let samples: number[];
      try {
        const response = await settings.fetch_(queryUrl(base, promql), {
          headers: settings.headers_,
          signal: requestSignal(settings.timeout_, context.signal),
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}${errorOf(parsed(text))}`);
        }
        samples = samplesOf(JSON.parse(text));
      } catch (error) {
        // The run's own cancellation is not the candidate's failure.
        context.signal?.throwIfAborted();
        throw fail(`${settings.name_} could not be read: ${messageOf(error)}`);
      }
      for (const value of samples) {
        try {
          checkThreshold(settings.name_, value, bounds);
        } catch (error) {
          throw fail(messageOf(error));
        }
      }
    },
  };
}

/** The numeric samples of a successful instant-query response. */
function samplesOf(body: unknown): number[] {
  const data = field(body, "data");
  const kind = field(data, "resultType");
  const result = field(data, "result");
  if (field(body, "status") !== "success") {
    throw new Error(`query failed${errorOf(body)}`);
  }
  if (kind === "scalar") return [valueOf(result)];
  if (kind !== "vector" || !Array.isArray(result)) {
    throw new Error(`expected a vector or scalar result, got ${String(kind)}`);
  }
  if (result.length === 0) {
    throw new Error(
      "the query returned no samples — append `or vector(0)` if no data " +
        "means healthy",
    );
  }
  return result.map((sample) => valueOf(field(sample, "value")));
}

/**
 * The number in a Prometheus `[timestamp, "value"]` pair. Prometheus writes
 * infinities as `+Inf`/`-Inf`, which `Number` does not read; `NaN` stays NaN
 * and fails the check — a ratio over no traffic (0/0) is NaN, so guard such a
 * query (`… and on() sum(rate(requests[5m])) > 0`, or `or vector(0)`).
 */
function valueOf(pair: unknown): number {
  if (!Array.isArray(pair) || typeof pair[1] !== "string") {
    throw new Error("a sample has no [timestamp, value] pair");
  }
  if (pair[1] === "+Inf") return Number.POSITIVE_INFINITY;
  if (pair[1] === "-Inf") return Number.NEGATIVE_INFINITY;
  return Number(pair[1]);
}

/**
 * The instant-query URL under `base`, keeping any path or query string it
 * already has (a tenant parameter, a proxy prefix).
 */
function queryUrl(base: string, promql: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/query`;
  url.searchParams.set("query", promql);
  return url.href;
}

/** `text` parsed as JSON, or `undefined` when it is not JSON (an HTML error page). */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `": <error>"` from a Prometheus error body, or nothing. */
function errorOf(body: unknown): string {
  const error = field(body, "error");
  return typeof error === "string" ? `: ${error}` : "";
}

/** `value[key]` when `value` is an object, else `undefined`. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
