// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `prometheus(...)`: run an instant PromQL query and fail the canary when any
 * sample is out of bounds.
 *
 * The query goes through `@zuke/prometheus`, so there is one Prometheus
 * transport: its URL guard, credential redaction, response cap and result
 * parsing apply here exactly as they do to any build's own query. What stays
 * in this module is the analysis — the settings a rollout names, the bounds,
 * and the failure messages a canary has always reported.
 *
 * @module
 */

import { parseDuration, redactUrls } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  PrometheusApiError,
  type PrometheusConnectionSettings,
  type PrometheusQuerySettings,
  PrometheusTasks,
} from "@zuke/prometheus";
import { boundsOf, checkThreshold } from "./threshold.ts";
import type { CanaryAnalysis } from "./types.ts";
import { messageOf } from "./message.ts";

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
  /** Further connection settings (set by {@link connection}). */
  connection_: Configure<PrometheusConnectionSettings> = (s) => s;

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

  /**
   * Add a request header — `header("X-Scope-OrgID", tenant)`, or
   * `header("Authorization", `Bearer ${token}`)`. As in `@zuke/prometheus`,
   * a plain header such as a tenant id leaves an in-cluster `http://` URL
   * usable, while `Authorization`, `Proxy-Authorization`, `Cookie` and a
   * credential-looking name (`X-API-Key`, `X-Auth-Token`) are credentials and
   * need `https:` (unless loopback, or `ZUKE_ALLOW_INSECURE_URL` is set).
   */
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

  /**
   * Configure the rest of the connection with `@zuke/prometheus`'s own
   * settings — the managed services' credentials, an API-key header, a
   * response cap:
   *
   * ```ts
   * prometheus((p) =>
   *   p.url("https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1")
   *     .query(ERROR_RATIO).max(0.01)
   *     .connection((c) => c.sigv4((a) => a.region("us-east-1")))
   * )
   * ```
   *
   * Applied after `url`, `header`, `timeout` and `fetch`, so a request
   * signer configured here signs the headers set above.
   */
  connection(configure: Configure<PrometheusConnectionSettings>): this {
    this.connection_ = configure;
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
 * The lambda runs on each check, so it may read resolved parameters. The query
 * is sent by `PrometheusTasks.query` from `@zuke/prometheus`, as a `GET` with
 * the expression in the URL — as this analysis always has. A URL sent a
 * credential must be `https:` unless it is loopback (or
 * `ZUKE_ALLOW_INSECURE_URL` is set). A credential is an `Authorization`,
 * `Proxy-Authorization` or `Cookie` header, a header whose name looks like a
 * credential's (`X-API-Key`, `X-Auth-Token`), `user:password@` or a credential
 * parameter in the URL, or anything set through `connection(...)` — a
 * `secretHeader(...)`, `sigv4()`, `google()`, `azure()`. Any other header,
 * such as an `X-Scope-OrgID` tenant id, leaves an in-cluster
 * `http://prometheus.monitoring.svc:9090` usable. Failure
 * messages pass through the run's redactor, so a secret parameter in the URL
 * or the query is masked, and a header value (eight or more characters) never
 * appears in them.
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
        const response = await PrometheusTasks.query((q) =>
          connect(q, base, settings, context.signal).query(promql)
        );
        samples = PrometheusTasks.samples(response).map((s) => s.value);
        if (samples.length === 0) {
          throw new Error(
            "the query returned no samples — append `or vector(0)` if no " +
              "data means healthy",
          );
        }
      } catch (error) {
        // The run's own cancellation is not the candidate's failure.
        context.signal?.throwIfAborted();
        throw fail(`${settings.name_} could not be read: ${reasonOf(error)}`);
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

/**
 * The query's connection, from the analysis settings: the URL, the headers,
 * the timeout, the `fetch` seam, and the run's signal. Sent as `GET`, which is
 * what this analysis has always sent — a proxy in front of Prometheus that
 * only passes `GET` keeps working.
 */
function connect(
  query: PrometheusQuerySettings,
  base: string,
  settings: PrometheusSettings,
  signal: AbortSignal | undefined,
): PrometheusQuerySettings {
  query.url(base).httpMethod("GET")
    .requestTimeout(settings.timeout_).fetch(settings.fetch_);
  for (const [name, value] of Object.entries(settings.headers_)) {
    query.header(name, value);
  }
  settings.connection_(query);
  return signal === undefined ? query : query.signal(signal);
}

/**
 * Why the query could not be read, in the words this analysis has always
 * used: `HTTP <status>: <error>` for a refusal, `query failed: <error>` for an
 * error envelope that came with a 2xx, and the message for anything else.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof PrometheusApiError)) return messageOf(error);
  const detail = error.detail === undefined ? "" : `: ${error.detail}`;
  return error.status >= 200 && error.status < 300
    ? `query failed${detail}`
    : `HTTP ${error.status}${detail}`;
}
