// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link PrometheusTasks}: one method per Prometheus HTTP API endpoint, each
 * configured by a settings lambda that sets the connection and the call's own
 * parameters, plus the readers that get plain numbers out of a query result.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { PrometheusConnectionSettings } from "./connection.ts";
import {
  labelsCall,
  labelValuesCall,
  metadataCall,
  parseMetadataData,
  parseSeriesData,
  parseStringList,
  PrometheusLabelsSettings,
  PrometheusLabelValuesSettings,
  PrometheusMetadataSettings,
  type PrometheusMetricMetadata,
  PrometheusSeriesSettings,
  seriesCall,
} from "./metadata.ts";
import {
  instantQueryCall,
  parseRangeData,
  PrometheusQueryRangeSettings,
  PrometheusQuerySettings,
  rangeQueryCall,
} from "./query.ts";
import { readSamples, readValue } from "./readers.ts";
import {
  parseAlertsData,
  parseRulesData,
  type PrometheusAlerts,
  type PrometheusRules,
  PrometheusRulesSettings,
  rulesCall,
} from "./rules.ts";
import {
  parseBuildInfoData,
  parseTargetsData,
  type PrometheusBuildInfo,
  type PrometheusTargets,
  PrometheusTargetsSettings,
  targetsCall,
} from "./targets.ts";
import { callApi, callProbe } from "./transport.ts";
import type {
  PrometheusFloatSample,
  PrometheusLabels,
  PrometheusMatrix,
  PrometheusQueryData,
  PrometheusResponse,
} from "./types.ts";
import { parseQueryData } from "./values.ts";

/** The operations {@link PrometheusTasks} exposes. */
export interface PrometheusTasksApi {
  /**
   * Evaluate an instant query (`/api/v1/query`).
   *
   * ```ts
   * const result = await PrometheusTasks.query((s) =>
   *   s.url("https://prometheus.internal").bearerToken(token)
   *     .query('sum(rate(http_requests_total{code=~"5.."}[5m]))')
   * );
   * ```
   */
  query(
    configure: Configure<PrometheusQuerySettings>,
  ): Promise<PrometheusResponse<PrometheusQueryData>>;
  /** Evaluate a range query (`/api/v1/query_range`); the answer is a matrix. */
  queryRange(
    configure: Configure<PrometheusQueryRangeSettings>,
  ): Promise<PrometheusResponse<PrometheusMatrix>>;
  /** Find the series matching selectors (`/api/v1/series`). */
  series(
    configure: Configure<PrometheusSeriesSettings>,
  ): Promise<PrometheusResponse<PrometheusLabels[]>>;
  /** List label names (`/api/v1/labels`). */
  labels(
    configure: Configure<PrometheusLabelsSettings>,
  ): Promise<PrometheusResponse<string[]>>;
  /** List one label's values (`/api/v1/label/<label_name>/values`). */
  labelValues(
    configure: Configure<PrometheusLabelValuesSettings>,
  ): Promise<PrometheusResponse<string[]>>;
  /** Read metric metadata (`/api/v1/metadata`), keyed by metric name. */
  metadata(
    configure: Configure<PrometheusMetadataSettings>,
  ): Promise<
    PrometheusResponse<
      Readonly<Record<string, readonly PrometheusMetricMetadata[]>>
    >
  >;
  /** Read target discovery state (`/api/v1/targets`). */
  targets(
    configure: Configure<PrometheusTargetsSettings>,
  ): Promise<PrometheusResponse<PrometheusTargets>>;
  /** Read the loaded alerting and recording rules (`/api/v1/rules`). */
  rules(
    configure: Configure<PrometheusRulesSettings>,
  ): Promise<PrometheusResponse<PrometheusRules>>;
  /** Read the active alerts (`/api/v1/alerts`). */
  alerts(
    configure: Configure<PrometheusConnectionSettings>,
  ): Promise<PrometheusResponse<PrometheusAlerts>>;
  /** Read the server's build information (`/api/v1/status/buildinfo`). */
  buildInfo(
    configure: Configure<PrometheusConnectionSettings>,
  ): Promise<PrometheusResponse<PrometheusBuildInfo>>;
  /**
   * Probe `/-/healthy`: `true` on 2xx, `false` on 503, and a
   * `PrometheusApiError` on any other status — a 401 is a credential
   * problem, not an unhealthy server.
   */
  healthy(configure: Configure<PrometheusConnectionSettings>): Promise<boolean>;
  /**
   * Probe `/-/ready`: `true` once the server serves queries, `false` while it
   * answers 503, and a `PrometheusApiError` on any other status.
   */
  ready(configure: Configure<PrometheusConnectionSettings>): Promise<boolean>;
  /**
   * The single number an instant query returned — a scalar, or a vector of
   * exactly one float sample — failing clearly on an empty or multi-sample
   * vector, a matrix, a string or a native histogram.
   *
   * ```ts
   * const ratio = PrometheusTasks.value(await PrometheusTasks.query((s) => …));
   * ```
   */
  value(response: PrometheusResponse<PrometheusQueryData>): number;
  /**
   * Every float sample of an instant query, with its labels: a vector's
   * elements, or a scalar as one unlabelled sample. An empty vector is an
   * empty list; a matrix, string or native histogram fails.
   */
  samples(
    response: PrometheusResponse<PrometheusQueryData>,
  ): PrometheusFloatSample[];
}

/**
 * The Prometheus HTTP API as tasks
 * (<https://prometheus.io/docs/prometheus/latest/querying/api/>).
 */
export const PrometheusTasks: PrometheusTasksApi = {
  async query(configure) {
    const settings = configure(new PrometheusQuerySettings());
    return await callApi(settings, instantQueryCall(settings), parseQueryData);
  },
  async queryRange(configure) {
    const settings = configure(new PrometheusQueryRangeSettings());
    return await callApi(settings, rangeQueryCall(settings), parseRangeData);
  },
  async series(configure) {
    const settings = configure(new PrometheusSeriesSettings());
    return await callApi(settings, seriesCall(settings), parseSeriesData);
  },
  async labels(configure) {
    const settings = configure(new PrometheusLabelsSettings());
    return await callApi(settings, labelsCall(settings), parseStringList);
  },
  async labelValues(configure) {
    const settings = configure(new PrometheusLabelValuesSettings());
    return await callApi(settings, labelValuesCall(settings), parseStringList);
  },
  async metadata(configure) {
    const settings = configure(new PrometheusMetadataSettings());
    return await callApi(settings, metadataCall(settings), parseMetadataData);
  },
  async targets(configure) {
    const settings = configure(new PrometheusTargetsSettings());
    return await callApi(settings, targetsCall(settings), parseTargetsData);
  },
  async rules(configure) {
    const settings = configure(new PrometheusRulesSettings());
    return await callApi(settings, rulesCall(settings), parseRulesData);
  },
  async alerts(configure) {
    return await callApi(
      configure(new PrometheusConnectionSettings()),
      { method: "GET", path: "/api/v1/alerts", params: [] },
      parseAlertsData,
    );
  },
  async buildInfo(configure) {
    return await callApi(
      configure(new PrometheusConnectionSettings()),
      { method: "GET", path: "/api/v1/status/buildinfo", params: [] },
      parseBuildInfoData,
    );
  },
  async healthy(configure) {
    return await callProbe(
      configure(new PrometheusConnectionSettings()),
      "/-/healthy",
    );
  },
  async ready(configure) {
    return await callProbe(
      configure(new PrometheusConnectionSettings()),
      "/-/ready",
    );
  },
  value: readValue,
  samples: readSamples,
};
