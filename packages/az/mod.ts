// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/az` — typed Azure CLI tasks for Zuke builds, readers and a canary analysis.
 *
 * The `az` CLI wrapper has typed settings for the deploy path (login,
 * account, resource groups, ACR, AKS, Container Apps, App Service, Functions,
 * Key Vault, deployments, blob storage), Azure Monitor metrics and Log
 * Analytics, readers that return a value, and an `azureMonitor(...)` analysis
 * for `@zuke/canary` rollouts.
 *
 * ```ts
 * import { AzTasks, azureMonitor } from "@zuke/az";
 *
 * const subscription = await AzTasks.subscriptionId();
 * await AzTasks.containerappUpdate((s) =>
 *   s.name("api").resourceGroup("rg-prod").image("myregistry.azurecr.io/api:1.4.0")
 * );
 * const failures = await AzTasks.metricValue((s) =>
 *   s.resource(appInsightsId).metrics("requests/failed").aggregation("Count")
 *     .window("15m").aggregate("sum").missingDataAs(0)
 * );
 * ```
 *
 * The wrapper builds a discrete argv array (never a shell string), and every
 * settings class takes a `.runner(...)`, so a build's Azure steps are testable
 * without a subscription or the CLI.
 *
 * @module
 */

export * from "./src/az.ts";
export { type AzOutputFormat, type AzSettingsRunner } from "./src/settings.ts";
export { AzOutputError } from "./src/errors.ts";
export { type AzTime } from "./src/time.ts";
export { AzResourceSettings } from "./src/resource.ts";
export { AzLoginSettings, AzLogoutSettings } from "./src/login.ts";
export {
  type AzAccessTokenResourceType,
  AzAccountGetAccessTokenSettings,
  AzAccountListSettings,
  AzAccountSetSettings,
  AzAccountShowSettings,
} from "./src/account.ts";
export {
  type AzForceDeletionType,
  AzGroupCreateSettings,
  AzGroupDeleteSettings,
  AzGroupExistsSettings,
  AzGroupShowSettings,
} from "./src/group.ts";
export {
  AzAcrBuildSettings,
  AzAcrLoginSettings,
  AzAcrRepositoryDeleteSettings,
  AzAcrRepositoryShowTagsSettings,
} from "./src/acr.ts";
export { AzAksGetCredentialsSettings, AzAksShowSettings } from "./src/aks.ts";
export {
  AzContainerappIngressTrafficSetSettings,
  AzContainerappRevisionListSettings,
  AzContainerappRevisionSettings,
  AzContainerappShowSettings,
  AzContainerappUpdateSettings,
} from "./src/containerapp.ts";
export {
  type AzSlotSwapAction,
  type AzWebappArtifactType,
  AzWebappConfigAppsettingsSetSettings,
  AzWebappDeploymentSlotSwapSettings,
  AzWebappDeploySettings,
  AzWebappShowSettings,
} from "./src/webapp.ts";
export { AzFunctionappDeploymentSourceConfigZipSettings } from "./src/functionapp.ts";
export {
  type AzKeyvaultSecretEncoding,
  AzKeyvaultSecretSetSettings,
  AzKeyvaultSecretShowSettings,
} from "./src/keyvault.ts";
export {
  AzDeploymentGroupCreateSettings,
  AzDeploymentGroupShowSettings,
  AzDeploymentGroupTemplateSettings,
  AzDeploymentGroupWhatIfSettings,
  type AzDeploymentMode,
  type AzWhatIfChangeType,
} from "./src/deployment.ts";
export {
  type AzStorageAuthMode,
  AzStorageBlobDownloadSettings,
  AzStorageBlobSettings,
  AzStorageBlobUploadBatchSettings,
  AzStorageBlobUploadSettings,
} from "./src/storage.ts";
export {
  AzMonitorActivityLogListSettings,
  type AzMonitorAggregation,
  type AzMonitorInterval,
  AzMonitorMetricsAlertListSettings,
  AzMonitorMetricsAlertShowSettings,
  AzMonitorMetricsListDefinitionsSettings,
  AzMonitorMetricsListSettings,
} from "./src/monitor.ts";
export {
  type AzMonitorAggregate,
  AzMonitorMetricValueSettings,
} from "./src/metric_value.ts";
export {
  type AzLogAnalyticsRow,
  AzMonitorLogAnalyticsQuerySettings,
} from "./src/log_analytics.ts";
export {
  type AzMonitorAnalysis,
  type AzMonitorAnalysisContext,
  AzMonitorAnalysisSettings,
  azureMonitor,
} from "./src/monitor_canary.ts";
