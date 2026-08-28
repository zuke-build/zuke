// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DockerTasks` — typed task functions for the `docker` CLI, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.build((s) => s.tag("app:latest").file("Dockerfile"));
 * await DockerTasks.push((s) => s.image("app:latest"));
 * const running = await DockerTasks.psEntries();
 * ```
 *
 * Every task shares docker's global options — `.dockerContext()`, `.host()`,
 * `.logLevel()`, `.config()`, `.debug()` — which docker requires *before* the
 * subcommand. Most tasks resolve to the raw
 * {@link "@zuke/core/shell".CommandOutput}; the four that name a value —
 * `psEntries`, `imageEntries`, `volumeNames`, `networkNames` — run a
 * machine-readable form and hand back parsed data instead.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { DockerBuildSettings } from "./build.ts";
import {
  DockerCreateSettings,
  DockerExecSettings,
  DockerRunSettings,
} from "./container_run.ts";
import {
  DockerKillSettings,
  DockerPauseSettings,
  DockerRenameSettings,
  DockerRestartSettings,
  DockerRmSettings,
  DockerStartSettings,
  DockerStopSettings,
  DockerUnpauseSettings,
  DockerUpdateSettings,
  DockerWaitSettings,
} from "./container.ts";
import {
  type DockerContainerEntry,
  DockerDiffSettings,
  DockerInspectSettings,
  DockerLogsSettings,
  DockerPortSettings,
  DockerPsSettings,
  DockerStatsSettings,
  DockerTopSettings,
  readContainerEntries,
} from "./container_info.ts";
import {
  DockerCommitSettings,
  DockerCpSettings,
  DockerExportSettings,
} from "./transfer.ts";
import {
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
  readImageEntries,
} from "./image.ts";
import {
  DockerLoginSettings,
  DockerLogoutSettings,
  DockerSearchSettings,
} from "./registry.ts";
import {
  DockerInfoSettings,
  DockerSystemSettings,
  DockerVersionSettings,
} from "./system.ts";
import { DockerVolumeSettings, readVolumeNames } from "./volume.ts";
import { DockerNetworkSettings, readNetworkNames } from "./network.ts";
import { DockerContextSettings } from "./context.ts";

/** The shape of {@link DockerTasks}. */
export interface DockerTasksApi {
  /** Build an image: `docker build`. */
  build(configure?: Configure<DockerBuildSettings>): Promise<CommandOutput>;
  /** Run a container: `docker run`. */
  run(configure?: Configure<DockerRunSettings>): Promise<CommandOutput>;
  /** Create a container without starting it: `docker create`. */
  create(configure?: Configure<DockerCreateSettings>): Promise<CommandOutput>;
  /** Run a command in a container: `docker exec`. */
  exec(configure?: Configure<DockerExecSettings>): Promise<CommandOutput>;
  /** Start containers: `docker start`. */
  start(configure?: Configure<DockerStartSettings>): Promise<CommandOutput>;
  /** Stop containers: `docker stop`. */
  stop(configure?: Configure<DockerStopSettings>): Promise<CommandOutput>;
  /** Restart containers: `docker restart`. */
  restart(configure?: Configure<DockerRestartSettings>): Promise<CommandOutput>;
  /** Signal containers: `docker kill`. */
  kill(configure?: Configure<DockerKillSettings>): Promise<CommandOutput>;
  /** Suspend a container's processes: `docker pause`. */
  pause(configure?: Configure<DockerPauseSettings>): Promise<CommandOutput>;
  /** Resume them: `docker unpause`. */
  unpause(configure?: Configure<DockerUnpauseSettings>): Promise<CommandOutput>;
  /** Remove containers: `docker rm`. */
  rm(configure?: Configure<DockerRmSettings>): Promise<CommandOutput>;
  /**
   * Block until containers stop, then print their exit codes: `docker wait` —
   * how a build gets a test container's result rather than the runner's.
   */
  wait(configure?: Configure<DockerWaitSettings>): Promise<CommandOutput>;
  /** Rename a container: `docker rename`. */
  rename(configure?: Configure<DockerRenameSettings>): Promise<CommandOutput>;
  /** Change a container's resource limits: `docker update`. */
  update(configure?: Configure<DockerUpdateSettings>): Promise<CommandOutput>;
  /** List containers: `docker ps`. */
  ps(configure?: Configure<DockerPsSettings>): Promise<CommandOutput>;
  /**
   * The containers as parsed {@link DockerContainerEntry} values, from
   * `docker ps --format '{{json .}}'`.
   */
  psEntries(
    configure?: Configure<DockerPsSettings>,
  ): Promise<DockerContainerEntry[]>;
  /** Read a container's logs: `docker logs`. */
  logs(configure?: Configure<DockerLogsSettings>): Promise<CommandOutput>;
  /** Describe docker objects: `docker inspect`. */
  inspect(configure?: Configure<DockerInspectSettings>): Promise<CommandOutput>;
  /** List a container's processes: `docker top`. */
  top(configure?: Configure<DockerTopSettings>): Promise<CommandOutput>;
  /** Sample resource usage once: `docker stats --no-stream`. */
  stats(configure?: Configure<DockerStatsSettings>): Promise<CommandOutput>;
  /** Show a container's port mappings: `docker port`. */
  port(configure?: Configure<DockerPortSettings>): Promise<CommandOutput>;
  /** Show a container's filesystem changes: `docker diff`. */
  diff(configure?: Configure<DockerDiffSettings>): Promise<CommandOutput>;
  /** Copy files between a container and the host: `docker cp`. */
  cp(configure?: Configure<DockerCpSettings>): Promise<CommandOutput>;
  /** Turn a container into an image: `docker commit`. */
  commit(configure?: Configure<DockerCommitSettings>): Promise<CommandOutput>;
  /** Export a container's filesystem: `docker export`. */
  export(configure?: Configure<DockerExportSettings>): Promise<CommandOutput>;
  /** List images: `docker images`. */
  images(configure?: Configure<DockerImagesSettings>): Promise<CommandOutput>;
  /**
   * The images as parsed {@link DockerImageEntry} values, from
   * `docker images --format '{{json .}}'`.
   */
  imageEntries(
    configure?: Configure<DockerImagesSettings>,
  ): Promise<DockerImageEntry[]>;
  /** Pull an image: `docker pull`. */
  pull(configure?: Configure<DockerPullSettings>): Promise<CommandOutput>;
  /** Push an image: `docker push`. */
  push(configure?: Configure<DockerPushSettings>): Promise<CommandOutput>;
  /** Tag an image: `docker tag`. */
  tag(configure?: Configure<DockerTagSettings>): Promise<CommandOutput>;
  /** Remove images: `docker rmi`. */
  rmi(configure?: Configure<DockerRmiSettings>): Promise<CommandOutput>;
  /** Save images to a tar archive: `docker save`. */
  save(configure?: Configure<DockerSaveSettings>): Promise<CommandOutput>;
  /** Load images from a tar archive: `docker load`. */
  load(configure?: Configure<DockerLoadSettings>): Promise<CommandOutput>;
  /** Show an image's layers: `docker history`. */
  history(configure?: Configure<DockerHistorySettings>): Promise<CommandOutput>;
  /** Create an image from a tarball: `docker import`. */
  import(configure?: Configure<DockerImportSettings>): Promise<CommandOutput>;
  /** Remove unused images: `docker image prune`. */
  imagePrune(
    configure?: Configure<DockerImagePruneSettings>,
  ): Promise<CommandOutput>;
  /** Authenticate to a registry: `docker login`. */
  login(configure?: Configure<DockerLoginSettings>): Promise<CommandOutput>;
  /** Forget a registry's credentials: `docker logout`. */
  logout(configure?: Configure<DockerLogoutSettings>): Promise<CommandOutput>;
  /** Search Docker Hub: `docker search`. */
  search(configure?: Configure<DockerSearchSettings>): Promise<CommandOutput>;
  /** Describe the daemon: `docker info`. */
  info(configure?: Configure<DockerInfoSettings>): Promise<CommandOutput>;
  /** Report client and daemon versions: `docker version`. */
  version(configure?: Configure<DockerVersionSettings>): Promise<CommandOutput>;
  /** Reclaim space or report usage: `docker system prune|df|info`. */
  system(configure?: Configure<DockerSystemSettings>): Promise<CommandOutput>;
  /** Manage volumes: `docker volume create|ls|rm|inspect|prune`. */
  volume(configure?: Configure<DockerVolumeSettings>): Promise<CommandOutput>;
  /** The volume names, from `docker volume ls --format '{{.Name}}'`. */
  volumeNames(
    configure?: Configure<DockerVolumeSettings>,
  ): Promise<string[]>;
  /** Manage networks: `docker network create|ls|rm|inspect|connect|…`. */
  network(configure?: Configure<DockerNetworkSettings>): Promise<CommandOutput>;
  /** The network names, from `docker network ls --format '{{.Name}}'`. */
  networkNames(
    configure?: Configure<DockerNetworkSettings>,
  ): Promise<string[]>;
  /** Manage the daemons to talk to: `docker context create|ls|use|…`. */
  context(configure?: Configure<DockerContextSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `docker` CLI. */
export const DockerTasks: DockerTasksApi = {
  build: (c) => runSettings(new DockerBuildSettings(), c),
  run: (c) => runSettings(new DockerRunSettings(), c),
  create: (c) => runSettings(new DockerCreateSettings(), c),
  exec: (c) => runSettings(new DockerExecSettings(), c),
  start: (c) => runSettings(new DockerStartSettings(), c),
  stop: (c) => runSettings(new DockerStopSettings(), c),
  restart: (c) => runSettings(new DockerRestartSettings(), c),
  kill: (c) => runSettings(new DockerKillSettings(), c),
  pause: (c) => runSettings(new DockerPauseSettings(), c),
  unpause: (c) => runSettings(new DockerUnpauseSettings(), c),
  rm: (c) => runSettings(new DockerRmSettings(), c),
  wait: (c) => runSettings(new DockerWaitSettings(), c),
  rename: (c) => runSettings(new DockerRenameSettings(), c),
  update: (c) => runSettings(new DockerUpdateSettings(), c),
  ps: (c) => runSettings(new DockerPsSettings(), c),
  psEntries: (c) => readContainerEntries(c),
  logs: (c) => runSettings(new DockerLogsSettings(), c),
  inspect: (c) => runSettings(new DockerInspectSettings(), c),
  top: (c) => runSettings(new DockerTopSettings(), c),
  stats: (c) => runSettings(new DockerStatsSettings(), c),
  port: (c) => runSettings(new DockerPortSettings(), c),
  diff: (c) => runSettings(new DockerDiffSettings(), c),
  cp: (c) => runSettings(new DockerCpSettings(), c),
  commit: (c) => runSettings(new DockerCommitSettings(), c),
  export: (c) => runSettings(new DockerExportSettings(), c),
  images: (c) => runSettings(new DockerImagesSettings(), c),
  imageEntries: (c) => readImageEntries(c),
  pull: (c) => runSettings(new DockerPullSettings(), c),
  push: (c) => runSettings(new DockerPushSettings(), c),
  tag: (c) => runSettings(new DockerTagSettings(), c),
  rmi: (c) => runSettings(new DockerRmiSettings(), c),
  save: (c) => runSettings(new DockerSaveSettings(), c),
  load: (c) => runSettings(new DockerLoadSettings(), c),
  history: (c) => runSettings(new DockerHistorySettings(), c),
  import: (c) => runSettings(new DockerImportSettings(), c),
  imagePrune: (c) => runSettings(new DockerImagePruneSettings(), c),
  login: (c) => runSettings(new DockerLoginSettings(), c),
  logout: (c) => runSettings(new DockerLogoutSettings(), c),
  search: (c) => runSettings(new DockerSearchSettings(), c),
  info: (c) => runSettings(new DockerInfoSettings(), c),
  version: (c) => runSettings(new DockerVersionSettings(), c),
  system: (c) => runSettings(new DockerSystemSettings(), c),
  volume: (c) => runSettings(new DockerVolumeSettings(), c),
  volumeNames: (c) => readVolumeNames(c),
  network: (c) => runSettings(new DockerNetworkSettings(), c),
  networkNames: (c) => readNetworkNames(c),
  context: (c) => runSettings(new DockerContextSettings(), c),
};
