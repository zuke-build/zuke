// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GcloudTasks` — a typed wrapper for the `gcloud` CLI (Google Cloud SDK), in
 * the same settings-lambda style as the other Zuke tool wrappers.
 *
 * `gcloud` is vast, so the wrapper is a flexible command builder rather than a
 * per-command API: name the command group and verb with `.command(...)`, set
 * the common global flags fluently, and pass anything else with `.flag(...)` or
 * the `.args(...)` escape hatch.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.run((s) =>
 *   s.command("run", "deploy", "api")
 *     .project("my-proj").flag("region", "us-central1").quiet()
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import { GcloudSettings } from "./settings.ts";
import type { CommandOutput } from "@zuke/core/shell";
import {
  GcloudAuthActivateServiceAccountSettings,
  GcloudAuthConfigureDockerSettings,
  GcloudAuthListSettings,
  GcloudAuthPrintAccessTokenSettings,
  GcloudAuthPrintIdentityTokenSettings,
  GcloudAuthRevokeSettings,
} from "./auth_commands.ts";
import {
  GcloudConfigGetValueSettings,
  GcloudConfigListSettings,
  GcloudConfigSetSettings,
  GcloudConfigUnsetSettings,
} from "./config.ts";
import {
  GcloudBuildsDescribeSettings,
  GcloudBuildsListSettings,
  GcloudBuildsLogSettings,
  GcloudBuildsSubmitSettings,
} from "./builds.ts";
import {
  GcloudRunDeploySettings,
  GcloudRunServicesDescribeSettings,
  GcloudRunServicesListSettings,
  GcloudRunUpdateTrafficSettings,
  RUN_SERVICE_URL_FORMAT,
} from "./cloud_run.ts";
import {
  GcloudArtifactsImagesDeleteSettings,
  GcloudArtifactsImagesListSettings,
  GcloudArtifactsRepositoriesDescribeSettings,
  GcloudArtifactsRepositoriesListSettings,
} from "./artifacts.ts";
import {
  GcloudStorageCpSettings,
  GcloudStorageLsSettings,
  GcloudStorageRmSettings,
  GcloudStorageRsyncSettings,
} from "./storage.ts";
import {
  GcloudClustersDescribeSettings,
  GcloudClustersGetCredentialsSettings,
  GcloudClustersListSettings,
} from "./clusters.ts";
import {
  GcloudFunctionsDeploySettings,
  GcloudFunctionsDescribeSettings,
  GcloudSecretsVersionsAccessSettings,
} from "./functions.ts";
import { readScalar } from "./scalar_output.ts";

export { GcloudSettings };

/** The shape of {@link GcloudTasks}. */
export interface GcloudTasksApi {
  /** Run a `gcloud` command. */
  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput>;

  /** Activate a service account: `gcloud auth activate-service-account`. */
  authActivateServiceAccount(
    configure?: Configure<GcloudAuthActivateServiceAccountSettings>,
  ): Promise<CommandOutput>;

  /** Print an OAuth access token: `gcloud auth print-access-token`. */
  authPrintAccessToken(
    configure?: Configure<GcloudAuthPrintAccessTokenSettings>,
  ): Promise<CommandOutput>;

  /** The OAuth access token itself, read back as a string. */
  accessToken(
    configure?: Configure<GcloudAuthPrintAccessTokenSettings>,
  ): Promise<string>;

  /** Print an identity token: `gcloud auth print-identity-token`. */
  authPrintIdentityToken(
    configure?: Configure<GcloudAuthPrintIdentityTokenSettings>,
  ): Promise<CommandOutput>;

  /** The identity token itself, read back as a string. */
  identityToken(
    configure?: Configure<GcloudAuthPrintIdentityTokenSettings>,
  ): Promise<string>;

  /** Register gcloud as a Docker credential helper: `gcloud auth configure-docker`. */
  authConfigureDocker(
    configure?: Configure<GcloudAuthConfigureDockerSettings>,
  ): Promise<CommandOutput>;

  /** List credentialed accounts: `gcloud auth list`. */
  authList(
    configure?: Configure<GcloudAuthListSettings>,
  ): Promise<CommandOutput>;

  /** Revoke credentials: `gcloud auth revoke`. */
  authRevoke(
    configure?: Configure<GcloudAuthRevokeSettings>,
  ): Promise<CommandOutput>;

  /** Set a property: `gcloud config set`. */
  configSet(
    configure?: Configure<GcloudConfigSetSettings>,
  ): Promise<CommandOutput>;

  /** Clear a property: `gcloud config unset`. */
  configUnset(
    configure?: Configure<GcloudConfigUnsetSettings>,
  ): Promise<CommandOutput>;

  /** Read a property: `gcloud config get-value`. */
  configGetValue(
    configure?: Configure<GcloudConfigGetValueSettings>,
  ): Promise<CommandOutput>;

  /** A configured property's value, read back as a string. */
  configValue(
    configure?: Configure<GcloudConfigGetValueSettings>,
  ): Promise<string>;

  /** List the active configuration: `gcloud config list`. */
  configList(
    configure?: Configure<GcloudConfigListSettings>,
  ): Promise<CommandOutput>;

  /** Submit a Cloud Build: `gcloud builds submit`. */
  buildsSubmit(
    configure?: Configure<GcloudBuildsSubmitSettings>,
  ): Promise<CommandOutput>;

  /** List builds: `gcloud builds list`. */
  buildsList(
    configure?: Configure<GcloudBuildsListSettings>,
  ): Promise<CommandOutput>;

  /** Describe a build: `gcloud builds describe`. */
  buildsDescribe(
    configure?: Configure<GcloudBuildsDescribeSettings>,
  ): Promise<CommandOutput>;

  /** Read a build's log: `gcloud builds log`. */
  buildsLog(
    configure?: Configure<GcloudBuildsLogSettings>,
  ): Promise<CommandOutput>;

  /** Deploy to Cloud Run: `gcloud run deploy`. */
  runDeploy(
    configure?: Configure<GcloudRunDeploySettings>,
  ): Promise<CommandOutput>;

  /** Describe a Cloud Run service: `gcloud run services describe`. */
  runServicesDescribe(
    configure?: Configure<GcloudRunServicesDescribeSettings>,
  ): Promise<CommandOutput>;

  /**
   * The URL Cloud Run assigned a service, read back as a string. Pins
   * `--format` to gcloud's own value projection, so gcloud extracts the field.
   */
  runServiceUrl(
    configure?: Configure<GcloudRunServicesDescribeSettings>,
  ): Promise<string>;

  /** List Cloud Run services: `gcloud run services list`. */
  runServicesList(
    configure?: Configure<GcloudRunServicesListSettings>,
  ): Promise<CommandOutput>;

  /** Move traffic between revisions: `gcloud run services update-traffic`. */
  runUpdateTraffic(
    configure?: Configure<GcloudRunUpdateTrafficSettings>,
  ): Promise<CommandOutput>;

  /** List images in Artifact Registry: `gcloud artifacts docker images list`. */
  artifactsImagesList(
    configure?: Configure<GcloudArtifactsImagesListSettings>,
  ): Promise<CommandOutput>;

  /** Delete an image: `gcloud artifacts docker images delete`. */
  artifactsImagesDelete(
    configure?: Configure<GcloudArtifactsImagesDeleteSettings>,
  ): Promise<CommandOutput>;

  /** List repositories: `gcloud artifacts repositories list`. */
  artifactsRepositoriesList(
    configure?: Configure<GcloudArtifactsRepositoriesListSettings>,
  ): Promise<CommandOutput>;

  /** Describe a repository: `gcloud artifacts repositories describe`. */
  artifactsRepositoriesDescribe(
    configure?: Configure<GcloudArtifactsRepositoriesDescribeSettings>,
  ): Promise<CommandOutput>;

  /** Copy to or from Cloud Storage: `gcloud storage cp`. */
  storageCp(
    configure?: Configure<GcloudStorageCpSettings>,
  ): Promise<CommandOutput>;

  /** Sync a tree to or from Cloud Storage: `gcloud storage rsync`. */
  storageRsync(
    configure?: Configure<GcloudStorageRsyncSettings>,
  ): Promise<CommandOutput>;

  /** List objects: `gcloud storage ls`. */
  storageLs(
    configure?: Configure<GcloudStorageLsSettings>,
  ): Promise<CommandOutput>;

  /** Remove objects: `gcloud storage rm`. */
  storageRm(
    configure?: Configure<GcloudStorageRmSettings>,
  ): Promise<CommandOutput>;

  /**
   * Write a kubeconfig entry for a GKE cluster:
   * `gcloud container clusters get-credentials`.
   */
  clustersGetCredentials(
    configure?: Configure<GcloudClustersGetCredentialsSettings>,
  ): Promise<CommandOutput>;

  /** List GKE clusters: `gcloud container clusters list`. */
  clustersList(
    configure?: Configure<GcloudClustersListSettings>,
  ): Promise<CommandOutput>;

  /** Describe a GKE cluster: `gcloud container clusters describe`. */
  clustersDescribe(
    configure?: Configure<GcloudClustersDescribeSettings>,
  ): Promise<CommandOutput>;

  /** Deploy a Cloud Function: `gcloud functions deploy`. */
  functionsDeploy(
    configure?: Configure<GcloudFunctionsDeploySettings>,
  ): Promise<CommandOutput>;

  /** Describe a Cloud Function: `gcloud functions describe`. */
  functionsDescribe(
    configure?: Configure<GcloudFunctionsDescribeSettings>,
  ): Promise<CommandOutput>;

  /** Read a secret version: `gcloud secrets versions access`. */
  secretsAccess(
    configure?: Configure<GcloudSecretsVersionsAccessSettings>,
  ): Promise<CommandOutput>;

  /** A secret version's payload, read back as a string. */
  secretValue(
    configure?: Configure<GcloudSecretsVersionsAccessSettings>,
  ): Promise<string>;
}

/**
 * Read one scalar from a command, with the reader's own name in any failure.
 *
 * The readers all run `.quiet()`: a token or a secret payload must not reach
 * the build log just because it was read.
 */
async function scalarFrom<S extends GcloudSettings>(
  settings: S,
  configure: Configure<S> | undefined,
  task: string,
  subject: string,
): Promise<string> {
  const configured = configure ? configure(settings) : settings;
  return readScalar(await configured.quiet().run(), task, subject);
}

/** Typed task functions for the `gcloud` CLI. */
export const GcloudTasks: GcloudTasksApi = {
  run: (c) => runSettings(new GcloudSettings(), c),

  authActivateServiceAccount: (c) =>
    runSettings(new GcloudAuthActivateServiceAccountSettings(), c),
  authPrintAccessToken: (c) =>
    runSettings(new GcloudAuthPrintAccessTokenSettings(), c),
  accessToken: (c) =>
    scalarFrom(
      new GcloudAuthPrintAccessTokenSettings(),
      c,
      "accessToken",
      "access token",
    ),
  authPrintIdentityToken: (c) =>
    runSettings(new GcloudAuthPrintIdentityTokenSettings(), c),
  identityToken: (c) =>
    scalarFrom(
      new GcloudAuthPrintIdentityTokenSettings(),
      c,
      "identityToken",
      "identity token",
    ),
  authConfigureDocker: (c) =>
    runSettings(new GcloudAuthConfigureDockerSettings(), c),
  authList: (c) => runSettings(new GcloudAuthListSettings(), c),
  authRevoke: (c) => runSettings(new GcloudAuthRevokeSettings(), c),

  configSet: (c) => runSettings(new GcloudConfigSetSettings(), c),
  configUnset: (c) => runSettings(new GcloudConfigUnsetSettings(), c),
  configGetValue: (c) => runSettings(new GcloudConfigGetValueSettings(), c),
  configValue: (c) =>
    scalarFrom(
      new GcloudConfigGetValueSettings(),
      c,
      "configValue",
      "configured value",
    ),
  configList: (c) => runSettings(new GcloudConfigListSettings(), c),

  buildsSubmit: (c) => runSettings(new GcloudBuildsSubmitSettings(), c),
  buildsList: (c) => runSettings(new GcloudBuildsListSettings(), c),
  buildsDescribe: (c) => runSettings(new GcloudBuildsDescribeSettings(), c),
  buildsLog: (c) => runSettings(new GcloudBuildsLogSettings(), c),

  runDeploy: (c) => runSettings(new GcloudRunDeploySettings(), c),
  runServicesDescribe: (c) =>
    runSettings(new GcloudRunServicesDescribeSettings(), c),
  runServiceUrl: (c) => {
    const settings = new GcloudRunServicesDescribeSettings();
    const configured = c ? c(settings) : settings;
    // Pinned after the caller's lambda: the reader promises a URL, so the
    // projection that produces one is not the caller's to replace.
    return scalarFrom(
      configured.format(RUN_SERVICE_URL_FORMAT),
      undefined,
      "runServiceUrl",
      "service URL",
    );
  },
  runServicesList: (c) => runSettings(new GcloudRunServicesListSettings(), c),
  runUpdateTraffic: (c) => runSettings(new GcloudRunUpdateTrafficSettings(), c),

  artifactsImagesList: (c) =>
    runSettings(new GcloudArtifactsImagesListSettings(), c),
  artifactsImagesDelete: (c) =>
    runSettings(new GcloudArtifactsImagesDeleteSettings(), c),
  artifactsRepositoriesList: (c) =>
    runSettings(new GcloudArtifactsRepositoriesListSettings(), c),
  artifactsRepositoriesDescribe: (c) =>
    runSettings(new GcloudArtifactsRepositoriesDescribeSettings(), c),

  storageCp: (c) => runSettings(new GcloudStorageCpSettings(), c),
  storageRsync: (c) => runSettings(new GcloudStorageRsyncSettings(), c),
  storageLs: (c) => runSettings(new GcloudStorageLsSettings(), c),
  storageRm: (c) => runSettings(new GcloudStorageRmSettings(), c),

  clustersGetCredentials: (c) =>
    runSettings(new GcloudClustersGetCredentialsSettings(), c),
  clustersList: (c) => runSettings(new GcloudClustersListSettings(), c),
  clustersDescribe: (c) => runSettings(new GcloudClustersDescribeSettings(), c),

  functionsDeploy: (c) => runSettings(new GcloudFunctionsDeploySettings(), c),
  functionsDescribe: (c) =>
    runSettings(new GcloudFunctionsDescribeSettings(), c),

  secretsAccess: (c) =>
    runSettings(new GcloudSecretsVersionsAccessSettings(), c),
  secretValue: (c) =>
    scalarFrom(
      new GcloudSecretsVersionsAccessSettings(),
      c,
      "secretValue",
      "secret payload",
    ),
};
