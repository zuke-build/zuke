// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A typed client for the Prometheus HTTP API, for Zuke builds. `PrometheusTasks`
 * has one method per endpoint — instant and range queries, series, labels,
 * metadata, targets, rules, alerts, build information and the health probes —
 * each configured by a settings lambda, and readers that turn a query result
 * into a plain number for a gate:
 *
 * ```ts
 * import { Build, parameter, run, target } from "@zuke/core";
 * import { PrometheusTasks } from "@zuke/prometheus";
 *
 * class Release extends Build {
 *   token = parameter("Prometheus token").secret().required();
 *   gate = target().executes(async () => {
 *     const result = await PrometheusTasks.query((s) =>
 *       s.url("https://prometheus.internal").bearerToken(this.token.value)
 *         .query('sum(rate(http_requests_total{code=~"5.."}[5m])) or vector(0)')
 *     );
 *     const errors = PrometheusTasks.value(result);
 *     if (!(errors <= 0.01)) throw new Error(`error rate ${errors} is too high`);
 *   });
 * }
 *
 * await run(Release);
 * ```
 *
 * Sample values arrive as numbers (`NaN` and the infinities included), native
 * histograms are typed, and Prometheus's `warnings` and `infos` come back with
 * every result. A refusal is a {@link PrometheusApiError} carrying the status
 * and `errorType`; no answer at all is a {@link PrometheusRequestError}; and
 * neither ever carries a credential. Authentication is pluggable through
 * {@link PrometheusCredentials}: bearer, basic, a header, or any function of
 * the outgoing request.
 *
 * @module
 */

export { PrometheusConnectionSettings } from "./src/connection.ts";
export type {
  PrometheusCredentials,
  PrometheusCredentialsContext,
  PrometheusHeaders,
  PrometheusOutgoingRequest,
} from "./src/credentials.ts";
export { PrometheusApiError, PrometheusRequestError } from "./src/errors.ts";
export {
  PrometheusLabelsSettings,
  PrometheusLabelValuesSettings,
  PrometheusMetadataSettings,
  type PrometheusMetricMetadata,
  PrometheusSelectionSettings,
  PrometheusSeriesSettings,
} from "./src/metadata.ts";
export {
  PrometheusExpressionSettings,
  PrometheusQueryRangeSettings,
  PrometheusQuerySettings,
} from "./src/query.ts";
export {
  type PrometheusAlert,
  type PrometheusAlertingRule,
  type PrometheusAlerts,
  type PrometheusRecordingRule,
  type PrometheusRule,
  type PrometheusRuleFields,
  type PrometheusRuleGroup,
  type PrometheusRules,
  PrometheusRulesSettings,
  type PrometheusRuleType,
} from "./src/rules.ts";
export {
  type PrometheusActiveTarget,
  type PrometheusBuildInfo,
  type PrometheusDroppedTarget,
  type PrometheusTargets,
  PrometheusTargetsSettings,
  type PrometheusTargetState,
} from "./src/targets.ts";
export { PrometheusTasks, type PrometheusTasksApi } from "./src/tasks.ts";
export type {
  PrometheusDuration,
  PrometheusFloatSample,
  PrometheusHistogram,
  PrometheusHistogramBucket,
  PrometheusHistogramPoint,
  PrometheusHistogramSample,
  PrometheusHttpMethod,
  PrometheusLabels,
  PrometheusMatrix,
  PrometheusPoint,
  PrometheusQueryData,
  PrometheusResponse,
  PrometheusScalar,
  PrometheusSeries,
  PrometheusStringResult,
  PrometheusTime,
  PrometheusVector,
  PrometheusVectorSample,
} from "./src/types.ts";
