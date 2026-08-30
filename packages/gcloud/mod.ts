// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/gcloud` — typed Google Cloud tooling for Zuke builds: the `gcloud`
 * (Google Cloud SDK) CLI wrapper, plus **GCS** and **Secret Manager** REST task
 * groups that share `gcloud`-based auth (no Google SDK dependency).
 *
 * ```ts
 * import { GcloudTasks, GcsTasks, SecretManagerTasks } from "jsr:@zuke/gcloud";
 *
 * await GcloudTasks.run((s) => s.containerImagesAddTag(src, dst)); // CLI
 * await GcsTasks.writeJson("bucket", "state.json", { slot: "sit-7" }); // REST
 * const pw = await SecretManagerTasks.access("db-password", { project }); // REST
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
  GcloudRunUpdateTrafficSettings,
  RUN_SERVICE_URL_FORMAT,
} from "./src/cloud_run.ts";
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
