// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/docker-compose` — typed Docker Compose task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The wrapper detects whether Compose is installed as the v2 plugin
 * (`docker compose`) or the v1 standalone binary (`docker-compose`) at run
 * time, so the same build works on either host.
 *
 * ```ts
 * import { DockerComposeTasks } from "jsr:@zuke/docker-compose";
 *
 * await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
 * await DockerComposeTasks.logs((s) => s.follow().tail(100));
 * await DockerComposeTasks.down((s) => s.volumes());
 * ```
 *
 * @module
 */

export {
  DockerComposeTasks,
  type DockerComposeTasksApi,
} from "./src/docker_compose.ts";
export {
  type ComposeProbe,
  defaultComposeProbe,
  resetComposeInvocationCache_,
  resolveComposeInvocation,
} from "./src/invocation.ts";
export {
  DockerComposeSettings,
  ReplicaIndex,
  ServiceList,
} from "./src/settings.ts";
export {
  DockerComposeCreateSettings,
  DockerComposeDownSettings,
  DockerComposeKillSettings,
  DockerComposePauseSettings,
  type DockerComposePullPolicy,
  DockerComposeRestartSettings,
  DockerComposeRmSettings,
  DockerComposeScaleSettings,
  DockerComposeServiceListSettings,
  DockerComposeStartSettings,
  DockerComposeStopSettings,
  DockerComposeUnpauseSettings,
  DockerComposeUpSettings,
  DockerComposeWaitSettings,
} from "./src/lifecycle.ts";
export {
  DockerComposeBuildSettings,
  DockerComposePullSettings,
  DockerComposePushSettings,
} from "./src/images.ts";
export {
  DockerComposeCommitSettings,
  DockerComposeConfigSettings,
  DockerComposeCpSettings,
  DockerComposeExecSettings,
  DockerComposeExportSettings,
  DockerComposeLogsSettings,
  DockerComposePsSettings,
  DockerComposeRunSettings,
  DockerComposeTopSettings,
} from "./src/containers.ts";
export {
  DockerComposeEventsSettings,
  DockerComposeImagesSettings,
  DockerComposeListingSettings,
  DockerComposeLsSettings,
  DockerComposePortSettings,
  DockerComposeVersionSettings,
  DockerComposeVolumesSettings,
} from "./src/inventory.ts";
export { type DockerComposeVersion } from "./src/reports.ts";
