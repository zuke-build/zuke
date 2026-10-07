// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `AzTasks` — a typed wrapper for the `az` CLI (Azure CLI), in the same
 * settings-lambda style as the other Zuke tool wrappers.
 *
 * The CLI is vast, so the wrapper is both: typed settings for the commands a
 * build's deploy path uses — login, account, resource groups, ACR, AKS,
 * Container Apps, App Service, Functions, Key Vault, deployments, blob
 * storage and Azure Monitor — and a general builder for everything else:
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.run((s) =>
 *   s.command("network", "front-door", "purge")
 *     .flag("resource-group", "rg-prod").flag("name", "edge")
 * );
 * ```
 *
 * Readers — {@link AzTasksApi.subscriptionId}, {@link AzTasksApi.secretValue},
 * {@link AzTasksApi.metricValue}, … — return a value rather than the
 * command's output. Each pins `--output` and `--query` after the caller's
 * lambda, so the CLI does the extraction, and each runs quietly so what it
 * read is not streamed to the build log.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated
 * shell string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { AzSettings } from "./settings.ts";
import { AzOutputError } from "./errors.ts";
import { jsonFrom, scalarFrom, WHOLE_ANSWER } from "./reader.ts";
import { isRecord } from "./shape.ts";
import { AzLoginSettings, AzLogoutSettings } from "./login.ts";
import {
  ACCESS_TOKEN_QUERY,
  AzAccountGetAccessTokenSettings,
  AzAccountListSettings,
  AzAccountSetSettings,
  AzAccountShowSettings,
  SUBSCRIPTION_ID_QUERY,
  TENANT_ID_QUERY,
} from "./account.ts";
import {
  AzGroupCreateSettings,
  AzGroupDeleteSettings,
  AzGroupExistsSettings,
  AzGroupShowSettings,
} from "./group.ts";
import {
  ACR_TOKEN_QUERY,
  AzAcrBuildSettings,
  AzAcrLoginSettings,
  AzAcrRepositoryDeleteSettings,
  AzAcrRepositoryShowTagsSettings,
} from "./acr.ts";
import { AzAksGetCredentialsSettings, AzAksShowSettings } from "./aks.ts";
import {
  AzContainerappIngressTrafficSetSettings,
  AzContainerappRevisionListSettings,
  AzContainerappRevisionSettings,
  AzContainerappShowSettings,
  AzContainerappUpdateSettings,
  FQDN_QUERY,
} from "./containerapp.ts";
import {
  AzWebappConfigAppsettingsSetSettings,
  AzWebappDeploymentSlotSwapSettings,
  AzWebappDeploySettings,
  AzWebappShowSettings,
  HOST_NAME_QUERY,
} from "./webapp.ts";
import { AzFunctionappDeploymentSourceConfigZipSettings } from "./functionapp.ts";
import {
  AzKeyvaultSecretSetSettings,
  AzKeyvaultSecretShowSettings,
  SECRET_VALUE_QUERY,
} from "./keyvault.ts";
import {
  AzDeploymentGroupCreateSettings,
  AzDeploymentGroupShowSettings,
  AzDeploymentGroupWhatIfSettings,
  OUTPUTS_QUERY,
} from "./deployment.ts";
import {
  AzStorageBlobDownloadSettings,
  AzStorageBlobUploadBatchSettings,
  AzStorageBlobUploadSettings,
} from "./storage.ts";
import {
  AzMonitorActivityLogListSettings,
  AzMonitorMetricsAlertListSettings,
  AzMonitorMetricsAlertShowSettings,
  AzMonitorMetricsListDefinitionsSettings,
  AzMonitorMetricsListSettings,
} from "./monitor.ts";
import { METRICS_QUERY } from "./metric_data.ts";
import { AzMonitorMetricValueSettings, metricValueOf } from "./metric_value.ts";
import {
  type AzLogAnalyticsRow,
  AzMonitorLogAnalyticsQuerySettings,
  needingExtension,
  rowsOf,
} from "./log_analytics.ts";

export { AzSettings };

/** The shape of {@link AzTasks}. */
export interface AzTasksApi {
  /** Run any `az` command, built with `.command(group, …, verb)`. */
  run(configure?: Configure<AzSettings>): Promise<CommandOutput>;

  /** Sign the CLI in, non-interactively: `az login`. */
  login(configure?: Configure<AzLoginSettings>): Promise<CommandOutput>;

  /** Sign the CLI out: `az logout`. */
  logout(configure?: Configure<AzLogoutSettings>): Promise<CommandOutput>;

  /** Describe the current subscription: `az account show`. */
  accountShow(
    configure?: Configure<AzAccountShowSettings>,
  ): Promise<CommandOutput>;

  /** Make a subscription the default: `az account set`. */
  accountSet(
    configure?: Configure<AzAccountSetSettings>,
  ): Promise<CommandOutput>;

  /** List the subscriptions: `az account list`. */
  accountList(
    configure?: Configure<AzAccountListSettings>,
  ): Promise<CommandOutput>;

  /** Get an access token: `az account get-access-token` (captured, never streamed). */
  accountGetAccessToken(
    configure?: Configure<AzAccountGetAccessTokenSettings>,
  ): Promise<CommandOutput>;

  /**
   * An access token, read back as a string and registered as a secret. Pins
   * `--query accessToken --output json`.
   */
  accessToken(
    configure?: Configure<AzAccountGetAccessTokenSettings>,
  ): Promise<string>;

  /** The subscription id the CLI acts on. Pins `--query id --output tsv`. */
  subscriptionId(configure?: Configure<AzAccountShowSettings>): Promise<string>;

  /** The tenant id of the current subscription. Pins `--query tenantId --output tsv`. */
  tenantId(configure?: Configure<AzAccountShowSettings>): Promise<string>;

  /** Create a resource group: `az group create`. */
  groupCreate(
    configure?: Configure<AzGroupCreateSettings>,
  ): Promise<CommandOutput>;

  /** Describe a resource group: `az group show`. */
  groupShow(configure?: Configure<AzGroupShowSettings>): Promise<CommandOutput>;

  /** Delete a resource group: `az group delete`. */
  groupDelete(
    configure?: Configure<AzGroupDeleteSettings>,
  ): Promise<CommandOutput>;

  /** Print whether a resource group exists: `az group exists`. */
  groupExists(
    configure?: Configure<AzGroupExistsSettings>,
  ): Promise<CommandOutput>;

  /** Whether resource group `name` exists. Pins `--output json`. */
  resourceGroupExists(
    name: string,
    configure?: Configure<AzGroupExistsSettings>,
  ): Promise<boolean>;

  /** Log in to a registry: `az acr login` (captured, never streamed). */
  acrLogin(configure?: Configure<AzAcrLoginSettings>): Promise<CommandOutput>;

  /**
   * A registry refresh token, for `docker login` as
   * `00000000-0000-0000-0000-000000000000`: `az acr login --expose-token`,
   * read back and registered as a secret. Pins `--query accessToken --output
   * json`.
   */
  acrToken(configure?: Configure<AzAcrLoginSettings>): Promise<string>;

  /** Build and push an image in the registry: `az acr build`. */
  acrBuild(configure?: Configure<AzAcrBuildSettings>): Promise<CommandOutput>;

  /** List a repository's tags: `az acr repository show-tags`. */
  acrRepositoryShowTags(
    configure?: Configure<AzAcrRepositoryShowTagsSettings>,
  ): Promise<CommandOutput>;

  /** Delete an image or a repository: `az acr repository delete`. */
  acrRepositoryDelete(
    configure?: Configure<AzAcrRepositoryDeleteSettings>,
  ): Promise<CommandOutput>;

  /** Write a cluster's credentials to a kubeconfig: `az aks get-credentials`. */
  aksGetCredentials(
    configure?: Configure<AzAksGetCredentialsSettings>,
  ): Promise<CommandOutput>;

  /** Describe a cluster: `az aks show`. */
  aksShow(configure?: Configure<AzAksShowSettings>): Promise<CommandOutput>;

  /** Roll a container app onto a new revision: `az containerapp update`. */
  containerappUpdate(
    configure?: Configure<AzContainerappUpdateSettings>,
  ): Promise<CommandOutput>;

  /** Describe a container app: `az containerapp show`. */
  containerappShow(
    configure?: Configure<AzContainerappShowSettings>,
  ): Promise<CommandOutput>;

  /**
   * A container app's ingress FQDN. Pins `--query
   * properties.configuration.ingress.fqdn --output tsv`; fails for an app
   * without ingress.
   */
  containerappFqdn(
    configure?: Configure<AzContainerappShowSettings>,
  ): Promise<string>;

  /** List a container app's revisions: `az containerapp revision list`. */
  containerappRevisionList(
    configure?: Configure<AzContainerappRevisionListSettings>,
  ): Promise<CommandOutput>;

  /** Activate a revision: `az containerapp revision activate`. */
  containerappRevisionActivate(
    configure?: Configure<AzContainerappRevisionSettings>,
  ): Promise<CommandOutput>;

  /** Deactivate a revision: `az containerapp revision deactivate`. */
  containerappRevisionDeactivate(
    configure?: Configure<AzContainerappRevisionSettings>,
  ): Promise<CommandOutput>;

  /** Split traffic between revisions or labels: `az containerapp ingress traffic set`. */
  containerappIngressTrafficSet(
    configure?: Configure<AzContainerappIngressTrafficSetSettings>,
  ): Promise<CommandOutput>;

  /** Deploy an artifact to a web app: `az webapp deploy`. */
  webappDeploy(
    configure?: Configure<AzWebappDeploySettings>,
  ): Promise<CommandOutput>;

  /** Describe a web app: `az webapp show`. */
  webappShow(
    configure?: Configure<AzWebappShowSettings>,
  ): Promise<CommandOutput>;

  /** A web app's default host name. Pins `--query defaultHostName --output tsv`. */
  webappHostName(configure?: Configure<AzWebappShowSettings>): Promise<string>;

  /** Set app settings: `az webapp config appsettings set`. */
  webappConfigAppsettingsSet(
    configure?: Configure<AzWebappConfigAppsettingsSetSettings>,
  ): Promise<CommandOutput>;

  /** Swap a deployment slot: `az webapp deployment slot swap`. */
  webappDeploymentSlotSwap(
    configure?: Configure<AzWebappDeploymentSlotSwapSettings>,
  ): Promise<CommandOutput>;

  /** Deploy a zip package to a function app: `az functionapp deployment source config-zip`. */
  functionappDeploymentSourceConfigZip(
    configure?: Configure<AzFunctionappDeploymentSourceConfigZipSettings>,
  ): Promise<CommandOutput>;

  /** Read a secret: `az keyvault secret show` (captured, never streamed). */
  keyvaultSecretShow(
    configure?: Configure<AzKeyvaultSecretShowSettings>,
  ): Promise<CommandOutput>;

  /**
   * A Key Vault secret's value, read back exactly — multi-line values and
   * surrounding whitespace included — and registered as a secret. Pins
   * `--query value --output json`.
   */
  secretValue(
    configure?: Configure<AzKeyvaultSecretShowSettings>,
  ): Promise<string>;

  /** Write a secret: `az keyvault secret set` (captured, never streamed). */
  keyvaultSecretSet(
    configure?: Configure<AzKeyvaultSecretSetSettings>,
  ): Promise<CommandOutput>;

  /** Deploy a template to a resource group: `az deployment group create`. */
  deploymentGroupCreate(
    configure?: Configure<AzDeploymentGroupCreateSettings>,
  ): Promise<CommandOutput>;

  /** Describe a deployment: `az deployment group show`. */
  deploymentGroupShow(
    configure?: Configure<AzDeploymentGroupShowSettings>,
  ): Promise<CommandOutput>;

  /** Preview what a deployment would change: `az deployment group what-if`. */
  deploymentGroupWhatIf(
    configure?: Configure<AzDeploymentGroupWhatIfSettings>,
  ): Promise<CommandOutput>;

  /**
   * One output of deployment `name` in resource group `group`, read back as
   * a string — a non-string output as its JSON text. Pins `--query
   * properties.outputs --output json`; fails when there is no such output.
   */
  deploymentOutput(
    group: string,
    name: string,
    key: string,
    configure?: Configure<AzDeploymentGroupShowSettings>,
  ): Promise<string>;

  /** Upload a file to a blob: `az storage blob upload`. */
  storageBlobUpload(
    configure?: Configure<AzStorageBlobUploadSettings>,
  ): Promise<CommandOutput>;

  /** Download a blob to a file: `az storage blob download`. */
  storageBlobDownload(
    configure?: Configure<AzStorageBlobDownloadSettings>,
  ): Promise<CommandOutput>;

  /** Upload a directory: `az storage blob upload-batch`. */
  storageBlobUploadBatch(
    configure?: Configure<AzStorageBlobUploadBatchSettings>,
  ): Promise<CommandOutput>;

  /** Read a resource's metrics: `az monitor metrics list`. */
  monitorMetricsList(
    configure?: Configure<AzMonitorMetricsListSettings>,
  ): Promise<CommandOutput>;

  /**
   * One number from Azure Monitor: the latest datapoint of a metric, or an
   * aggregate over the range. Pins `--query value --output json`; fails on
   * no data unless `.missingDataAs(value)` says what it means.
   */
  metricValue(
    configure: Configure<AzMonitorMetricValueSettings>,
  ): Promise<number>;

  /** List a resource's metric definitions: `az monitor metrics list-definitions`. */
  monitorMetricsListDefinitions(
    configure?: Configure<AzMonitorMetricsListDefinitionsSettings>,
  ): Promise<CommandOutput>;

  /** List metric alert rules: `az monitor metrics alert list`. */
  monitorMetricsAlertList(
    configure?: Configure<AzMonitorMetricsAlertListSettings>,
  ): Promise<CommandOutput>;

  /** Describe a metric alert rule: `az monitor metrics alert show`. */
  monitorMetricsAlertShow(
    configure?: Configure<AzMonitorMetricsAlertShowSettings>,
  ): Promise<CommandOutput>;

  /** List activity-log events: `az monitor activity-log list`. */
  monitorActivityLogList(
    configure?: Configure<AzMonitorActivityLogListSettings>,
  ): Promise<CommandOutput>;

  /** Run a KQL query: `az monitor log-analytics query` (the `log-analytics` extension). */
  monitorLogAnalyticsQuery(
    configure?: Configure<AzMonitorLogAnalyticsQuerySettings>,
  ): Promise<CommandOutput>;

  /**
   * The rows of a KQL query, every cell a string. Pins `--output json` and
   * the whole answer as the query.
   */
  logAnalyticsQuery(
    configure: Configure<AzMonitorLogAnalyticsQuerySettings>,
  ): Promise<AzLogAnalyticsRow[]>;
}

/** `settings`, configured by `configure` when there is one. */
function configured<S>(settings: S, configure: Configure<S> | undefined): S {
  return configure ? configure(settings) : settings;
}

/** The JSON string a pinned `--query` projected, or a clear refusal. */
function jsonString(value: unknown, task: string, subject: string): string {
  if (typeof value !== "string") {
    throw new AzOutputError(task, `the answer carries no ${subject}.`);
  }
  return value;
}

/** An ARM deployment output's value, as a string. */
function outputValue(
  outputs: unknown,
  group: string,
  name: string,
  key: string,
): string {
  const task = "AzTasks.deploymentOutput";
  if (!isRecord(outputs)) {
    throw new AzOutputError(
      task,
      `deployment "${name}" in "${group}" has no outputs.`,
    );
  }
  // ARM treats output names case-insensitively; the answer keeps the
  // template's spelling.
  const entry = Object.entries(outputs).find(([candidate]) =>
    candidate.toLowerCase() === key.toLowerCase()
  );
  const output = entry?.[1];
  if (!isRecord(output) || !("value" in output)) {
    throw new AzOutputError(
      task,
      `deployment "${name}" in "${group}" has no output "${key}".`,
    );
  }
  const { value } = output;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Typed task functions for the `az` CLI. */
export const AzTasks: AzTasksApi = {
  run: (c) => runSettings(new AzSettings(), c),

  login: (c) => runSettings(new AzLoginSettings(), c),
  logout: (c) => runSettings(new AzLogoutSettings(), c),

  accountShow: (c) => runSettings(new AzAccountShowSettings(), c),
  accountSet: (c) => runSettings(new AzAccountSetSettings(), c),
  accountList: (c) => runSettings(new AzAccountListSettings(), c),
  accountGetAccessToken: (c) =>
    runSettings(new AzAccountGetAccessTokenSettings(), c),
  accessToken: async (c) => {
    const task = "AzTasks.accessToken";
    const value = await jsonFrom(
      configured(new AzAccountGetAccessTokenSettings(), c),
      task,
      ACCESS_TOKEN_QUERY,
    );
    return jsonString(value, task, "accessToken");
  },
  // Pinned after the caller's lambda: the reader promises a subscription id,
  // so the projection that produces one is not the caller's to replace.
  subscriptionId: (c) =>
    scalarFrom(
      configured(new AzAccountShowSettings(), c),
      "AzTasks.subscriptionId",
      SUBSCRIPTION_ID_QUERY,
      "subscription id",
    ),
  tenantId: (c) =>
    scalarFrom(
      configured(new AzAccountShowSettings(), c),
      "AzTasks.tenantId",
      TENANT_ID_QUERY,
      "tenant id",
    ),

  groupCreate: (c) => runSettings(new AzGroupCreateSettings(), c),
  groupShow: (c) => runSettings(new AzGroupShowSettings(), c),
  groupDelete: (c) => runSettings(new AzGroupDeleteSettings(), c),
  groupExists: (c) => runSettings(new AzGroupExistsSettings(), c),
  resourceGroupExists: async (name, c) => {
    const task = "AzTasks.resourceGroupExists";
    const exists = await jsonFrom(
      configured(new AzGroupExistsSettings(), c).name(name),
      task,
      WHOLE_ANSWER,
    );
    if (typeof exists !== "boolean") {
      throw new AzOutputError(
        task,
        "group exists did not answer true or false.",
      );
    }
    return exists;
  },

  acrLogin: (c) => runSettings(new AzAcrLoginSettings(), c),
  acrToken: async (c) => {
    const task = "AzTasks.acrToken";
    const value = await jsonFrom(
      configured(new AzAcrLoginSettings(), c).exposeToken(),
      task,
      ACR_TOKEN_QUERY,
    );
    return jsonString(value, task, "accessToken");
  },
  acrBuild: (c) => runSettings(new AzAcrBuildSettings(), c),
  acrRepositoryShowTags: (c) =>
    runSettings(new AzAcrRepositoryShowTagsSettings(), c),
  acrRepositoryDelete: (c) =>
    runSettings(new AzAcrRepositoryDeleteSettings(), c),

  aksGetCredentials: (c) => runSettings(new AzAksGetCredentialsSettings(), c),
  aksShow: (c) => runSettings(new AzAksShowSettings(), c),

  containerappUpdate: (c) => runSettings(new AzContainerappUpdateSettings(), c),
  containerappShow: (c) => runSettings(new AzContainerappShowSettings(), c),
  containerappFqdn: (c) =>
    scalarFrom(
      configured(new AzContainerappShowSettings(), c),
      "AzTasks.containerappFqdn",
      FQDN_QUERY,
      "ingress FQDN — check the app has ingress enabled",
    ),
  containerappRevisionList: (c) =>
    runSettings(new AzContainerappRevisionListSettings(), c),
  containerappRevisionActivate: (c) =>
    runSettings(new AzContainerappRevisionSettings("activate"), c),
  containerappRevisionDeactivate: (c) =>
    runSettings(new AzContainerappRevisionSettings("deactivate"), c),
  containerappIngressTrafficSet: (c) =>
    runSettings(new AzContainerappIngressTrafficSetSettings(), c),

  webappDeploy: (c) => runSettings(new AzWebappDeploySettings(), c),
  webappShow: (c) => runSettings(new AzWebappShowSettings(), c),
  webappHostName: (c) =>
    scalarFrom(
      configured(new AzWebappShowSettings(), c),
      "AzTasks.webappHostName",
      HOST_NAME_QUERY,
      "host name",
    ),
  webappConfigAppsettingsSet: (c) =>
    runSettings(new AzWebappConfigAppsettingsSetSettings(), c),
  webappDeploymentSlotSwap: (c) =>
    runSettings(new AzWebappDeploymentSlotSwapSettings(), c),

  functionappDeploymentSourceConfigZip: (c) =>
    runSettings(new AzFunctionappDeploymentSourceConfigZipSettings(), c),

  keyvaultSecretShow: (c) => runSettings(new AzKeyvaultSecretShowSettings(), c),
  secretValue: async (c) => {
    const task = "AzTasks.secretValue";
    const value = await jsonFrom(
      configured(new AzKeyvaultSecretShowSettings(), c),
      task,
      SECRET_VALUE_QUERY,
    );
    return jsonString(value, task, "value");
  },
  keyvaultSecretSet: (c) => runSettings(new AzKeyvaultSecretSetSettings(), c),

  deploymentGroupCreate: (c) =>
    runSettings(new AzDeploymentGroupCreateSettings(), c),
  deploymentGroupShow: (c) =>
    runSettings(new AzDeploymentGroupShowSettings(), c),
  deploymentGroupWhatIf: (c) =>
    runSettings(new AzDeploymentGroupWhatIfSettings(), c),
  deploymentOutput: async (group, name, key, c) => {
    const outputs = await jsonFrom(
      configured(new AzDeploymentGroupShowSettings(), c)
        .resourceGroup(group).name(name),
      "AzTasks.deploymentOutput",
      OUTPUTS_QUERY,
    );
    return outputValue(outputs, group, name, key);
  },

  storageBlobUpload: (c) => runSettings(new AzStorageBlobUploadSettings(), c),
  storageBlobDownload: (c) =>
    runSettings(new AzStorageBlobDownloadSettings(), c),
  storageBlobUploadBatch: (c) =>
    runSettings(new AzStorageBlobUploadBatchSettings(), c),

  monitorMetricsList: (c) => runSettings(new AzMonitorMetricsListSettings(), c),
  metricValue: async (c) => {
    const settings = c(new AzMonitorMetricValueSettings());
    const document = await jsonFrom(
      settings,
      "AzTasks.metricValue",
      METRICS_QUERY,
    );
    return metricValueOf(document, settings);
  },
  monitorMetricsListDefinitions: (c) =>
    runSettings(new AzMonitorMetricsListDefinitionsSettings(), c),
  monitorMetricsAlertList: (c) =>
    runSettings(new AzMonitorMetricsAlertListSettings(), c),
  monitorMetricsAlertShow: (c) =>
    runSettings(new AzMonitorMetricsAlertShowSettings(), c),
  monitorActivityLogList: (c) =>
    runSettings(new AzMonitorActivityLogListSettings(), c),
  monitorLogAnalyticsQuery: (c) =>
    needingExtension(() =>
      runSettings(new AzMonitorLogAnalyticsQuerySettings(), c)
    ),
  logAnalyticsQuery: async (c) => {
    const task = "AzTasks.logAnalyticsQuery";
    const document = await needingExtension(() =>
      jsonFrom(c(new AzMonitorLogAnalyticsQuerySettings()), task, WHOLE_ANSWER)
    );
    return rowsOf(document, task);
  },
};
