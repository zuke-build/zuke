// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Expression queries: {@link PrometheusQuerySettings} for an instant query
 * (`/api/v1/query`) and {@link PrometheusQueryRangeSettings} for a range query
 * (`/api/v1/query_range`), with the parameters the API reference names.
 *
 * Both are sent as a `POST` form by default, which the API accepts for
 * exactly this reason: a long PromQL expression is not bound by a server's or
 * proxy's URL length limit. `httpMethod("GET")` sends them in the URL instead,
 * for a proxy that only passes `GET`.
 *
 * @module
 */

import { PrometheusConnectionSettings } from "./connection.ts";
import {
  definedParams,
  formatCount,
  formatDuration,
  formatTime,
  nonEmpty,
} from "./params.ts";
import type { PrometheusCall } from "./transport.ts";
import type {
  PrometheusDuration,
  PrometheusHttpMethod,
  PrometheusMatrix,
  PrometheusQueryData,
  PrometheusTime,
} from "./types.ts";
import { parseQueryData } from "./values.ts";

/** What an instant and a range query share: the expression and its limits. */
export class PrometheusExpressionSettings extends PrometheusConnectionSettings {
  /** The PromQL expression (set by {@link query}). */
  query_?: string;
  /** The evaluation timeout parameter (set by {@link timeout}). */
  timeout_?: string;
  /** The series limit parameter (set by {@link limit}). */
  limit_?: string;
  /** The lookback-delta parameter (set by {@link lookbackDelta}). */
  lookbackDelta_?: string;
  /** The HTTP method (set by {@link httpMethod}); `POST` by default. */
  httpMethod_: PrometheusHttpMethod = "POST";

  /** The PromQL expression (`query`). */
  query(promql: string): this {
    this.query_ = nonEmpty(promql, "query(...)");
    return this;
  }

  /**
   * The evaluation timeout (`timeout`), such as `"30s"` — capped by the
   * server's `-query.timeout`. The client-side limit is `requestTimeout`.
   */
  timeout(duration: PrometheusDuration): this {
    this.timeout_ = formatDuration(duration, "timeout(...)");
    return this;
  }

  /** The most series to return (`limit`); `0` means no limit. */
  limit(series: number): this {
    this.limit_ = formatCount(series, "limit(...)");
    return this;
  }

  /** Override the lookback period for this query (`lookback_delta`). */
  lookbackDelta(duration: PrometheusDuration): this {
    this.lookbackDelta_ = formatDuration(duration, "lookbackDelta(...)");
    return this;
  }

  /** Send the parameters as a `POST` form (the default) or in a `GET` URL. */
  httpMethod(method: PrometheusHttpMethod): this {
    this.httpMethod_ = method;
    return this;
  }
}

/** Settings for an instant query (`/api/v1/query`). */
export class PrometheusQuerySettings extends PrometheusExpressionSettings {
  /** The evaluation time (set by {@link time}); the server's now when unset. */
  time_?: string;

  /** The evaluation time (`time`): a `Date`, Unix seconds, or RFC 3339 text. */
  time(time: PrometheusTime): this {
    this.time_ = formatTime(time, "time(...)");
    return this;
  }
}

/** Settings for a range query (`/api/v1/query_range`). */
export class PrometheusQueryRangeSettings extends PrometheusExpressionSettings {
  /** The range's start (set by {@link start}). */
  start_?: string;
  /** The range's end (set by {@link end}). */
  end_?: string;
  /** The resolution step (set by {@link step}). */
  step_?: string;

  /** The inclusive start (`start`): a `Date`, Unix seconds, or RFC 3339 text. */
  start(time: PrometheusTime): this {
    this.start_ = formatTime(time, "start(...)");
    return this;
  }

  /** The inclusive end (`end`): a `Date`, Unix seconds, or RFC 3339 text. */
  end(time: PrometheusTime): this {
    this.end_ = formatTime(time, "end(...)");
    return this;
  }

  /** The resolution step (`step`): `"15s"`, or a number of seconds. */
  step(duration: PrometheusDuration): this {
    this.step_ = formatDuration(duration, "step(...)");
    return this;
  }
}

/** The expression, or the error naming the setter that supplies it. */
function expressionOf(settings: PrometheusExpressionSettings): string {
  if (settings.query_ === undefined) {
    throw new Error(
      "a Prometheus query needs an expression — call s.query(...).",
    );
  }
  return settings.query_;
}

/** The `/api/v1/query` call the settings describe. */
export function instantQueryCall(
  settings: PrometheusQuerySettings,
): PrometheusCall {
  return {
    method: settings.httpMethod_,
    path: "/api/v1/query",
    params: definedParams([
      ["query", expressionOf(settings)],
      ["time", settings.time_],
      ["timeout", settings.timeout_],
      ["limit", settings.limit_],
      ["lookback_delta", settings.lookbackDelta_],
    ]),
  };
}

/** The `/api/v1/query_range` call the settings describe. */
export function rangeQueryCall(
  settings: PrometheusQueryRangeSettings,
): PrometheusCall {
  const query = expressionOf(settings);
  const { start_: start, end_: end, step_: step } = settings;
  if (start === undefined || end === undefined || step === undefined) {
    throw new Error(
      "a Prometheus range query needs its range — call s.start(...), " +
        "s.end(...) and s.step(...).",
    );
  }
  return {
    method: settings.httpMethod_,
    path: "/api/v1/query_range",
    params: definedParams([
      ["query", query],
      ["start", start],
      ["end", end],
      ["step", step],
      ["timeout", settings.timeout_],
      ["limit", settings.limit_],
      ["lookback_delta", settings.lookbackDelta_],
    ]),
  };
}

/** A range query's data, which the API always answers as a matrix. */
export function parseRangeData(data: unknown): PrometheusMatrix {
  const parsed: PrometheusQueryData = parseQueryData(data);
  if (parsed.resultType !== "matrix") {
    throw new Error(
      `a range query answered with a ${parsed.resultType}, not a matrix`,
    );
  }
  return parsed;
}
