// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/gcloud` — typed Google Cloud tooling for Zuke builds: the `gcloud`
 * (Google Cloud SDK) CLI wrapper, plus **GCS**, **Secret Manager** and **Cloud
 * Monitoring** REST task groups that share `gcloud`-based auth (no Google SDK
 * dependency), and canary support for Cloud Run rollouts gated on Cloud
 * Monitoring.
 *
 * ```ts
 * import {
 *   CloudMonitoringTasks,
 *   GcloudTasks,
 *   GcsTasks,
 *   SecretManagerTasks,
 * } from "@zuke/gcloud";
 *
 * await GcloudTasks.run((s) => s.containerImagesAddTag(src, dst)); // CLI
 * await GcsTasks.writeJson("bucket", "state.json", { slot: "sit-7" }); // REST
 * const pw = await SecretManagerTasks.access("db-password", { project }); // REST
 * const errors = await CloudMonitoringTasks.metricValue((s) =>
 *   s.metricType("run.googleapis.com/request_count").window("15m")
 * ); // REST
 * ```
 *
 * The CLI wrapper builds a discrete argv array (never a shell string), and the
 * REST groups take an injectable `fetch`, so both are testable without network
 * or a real cluster.
 *
 * @module
 */

export * from "./src/gcloud.ts";
export {
  type AccessTokenProvider,
  gcloudAccessToken,
  type GcloudRunner,
  resolveAccessToken,
} from "./src/auth.ts";
export {
  type GcsListOptions,
  type GcsOptions,
  GcsTasks,
  type GcsTasksApi,
} from "./src/gcs.ts";
export {
  type SecretManagerAccessOptions,
  type SecretManagerOptions,
  SecretManagerTasks,
  type SecretManagerTasksApi,
} from "./src/secret_manager.ts";
export { type GcpRestOptions } from "./src/rest.ts";
export {
  GcloudAuthActivateServiceAccountSettings,
  GcloudAuthConfigureDockerSettings,
  GcloudAuthListSettings,
  GcloudAuthPrintAccessTokenSettings,
  GcloudAuthPrintIdentityTokenSettings,
  GcloudAuthRevokeSettings,
} from "./src/auth_commands.ts";
export {
  GcloudConfigGetValueSettings,
  GcloudConfigListSettings,
  GcloudConfigSetSettings,
  GcloudConfigUnsetSettings,
} from "./src/config.ts";
export {
  GcloudBuildsDescribeSettings,
  GcloudBuildsListSettings,
  GcloudBuildsLogSettings,
  GcloudBuildsSubmitSettings,
} from "./src/builds.ts";
export {
  GcloudRunDeploySettings,
  GcloudRunServicesDescribeSettings,
  GcloudRunServicesListSettings,
  GcloudRunServicesUpdateSettings,
  GcloudRunUpdateTrafficSettings,
  RUN_SERVICE_URL_FORMAT,
} from "./src/cloud_run.ts";
export {
  CloudRunCanary,
  cloudRunCanary,
  type CloudRunCanaryContext,
  CloudRunCanarySettings,
} from "./src/cloud_run_canary.ts";
export { type GcloudSettingsRunner } from "./src/settings.ts";
export {
  GcloudArtifactsImagesDeleteSettings,
  GcloudArtifactsImagesListSettings,
  GcloudArtifactsRepositoriesDescribeSettings,
  GcloudArtifactsRepositoriesListSettings,
} from "./src/artifacts.ts";
export {
  GcloudStorageCpSettings,
  GcloudStorageLsSettings,
  GcloudStorageRmSettings,
  GcloudStorageRsyncSettings,
} from "./src/storage.ts";
export {
  GcloudClustersDescribeSettings,
  GcloudClustersGetCredentialsSettings,
  GcloudClustersListSettings,
} from "./src/clusters.ts";
export {
  GcloudFunctionsDeploySettings,
  GcloudFunctionsDescribeSettings,
  GcloudSecretsVersionsAccessSettings,
} from "./src/functions.ts";
export {
  GcloudLoggingLogsListSettings,
  GcloudLoggingReadSettings,
  type GcloudLogSeverity,
  type GcloudLogTime,
} from "./src/logging.ts";
export {
  DEFAULT_COUNT_LIMIT,
  GcloudLoggingEntryCountSettings,
} from "./src/log_entry_count.ts";
export {
  GcloudMonitoringDashboardsListSettings,
  GcloudMonitoringListSettings,
  GcloudMonitoringPoliciesDescribeSettings,
  GcloudMonitoringPoliciesListSettings,
  GcloudMonitoringUptimeListConfigsSettings,
} from "./src/monitoring.ts";
export {
  CloudMonitoringTasks,
  type CloudMonitoringTasksApi,
} from "./src/cloud_monitoring.ts";
export {
  type CloudMonitoringAligner,
  type CloudMonitoringReducer,
  CloudMonitoringTimeSeriesSettings,
  type CloudMonitoringView,
} from "./src/time_series_settings.ts";
export {
  type CloudMonitoringLabelled,
  type CloudMonitoringPoint,
  type CloudMonitoringTimeSeries,
  type CloudMonitoringValue,
} from "./src/time_series.ts";
export {
  type CloudMonitoringAggregate,
  CloudMonitoringMetricValueSettings,
} from "./src/metric_value.ts";
export {
  cloudMonitoring,
  type CloudMonitoringAnalysis,
  type CloudMonitoringAnalysisContext,
  CloudMonitoringAnalysisSettings,
} from "./src/cloud_monitoring_canary.ts";
export { type CloudRunService } from "./src/cloud_run_candidate.ts";
export { GcloudOutputError } from "./src/errors.ts";
