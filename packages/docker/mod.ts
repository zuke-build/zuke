// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/docker` — typed `DockerTasks` wrappers for the `docker` CLI.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 *
 * await DockerTasks.build((s) => s.tag("app:latest"));
 * await DockerTasks.run((s) => s.rm().image("app:latest"));
 * const running = await DockerTasks.psEntries();
 * ```
 *
 * Typed tasks cover the everyday docker surface — building, running and
 * inspecting containers, moving images, the registry, and the `volume`,
 * `network`, `system`, and `context` groups. Four hand back parsed values
 * rather than raw output: `psEntries`, `imageEntries`, `volumeNames`, and
 * `networkNames`. The swarm commands (`service`, `stack`, `node`, `secret`)
 * and `compose` are out of scope; `compose` has its own package,
 * `@zuke/docker-compose`.
 *
 * @module
 */

export * from "./src/settings.ts";
export * from "./src/docker.ts";
export * from "./src/build.ts";
export * from "./src/container_run.ts";
export * from "./src/container.ts";
export * from "./src/transfer.ts";
export * from "./src/registry.ts";
export * from "./src/system.ts";
export * from "./src/context.ts";
export {
  type DockerContainerEntry,
  DockerDiffSettings,
  DockerInspectSettings,
  DockerLogsSettings,
  DockerPortSettings,
  DockerPsSettings,
  DockerStatsSettings,
  DockerTopSettings,
} from "./src/container_info.ts";
export {
  DockerHistorySettings,
  type DockerImageEntry,
  DockerImagePruneSettings,
  DockerImagesSettings,
  DockerImportSettings,
  DockerLoadSettings,
  DockerPullSettings,
  DockerPushSettings,
  DockerRmiSettings,
  DockerSaveSettings,
  DockerTagSettings,
} from "./src/image.ts";
export { DockerVolumeSettings } from "./src/volume.ts";
export { DockerNetworkSettings } from "./src/network.ts";
