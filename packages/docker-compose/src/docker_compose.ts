// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DockerComposeTasks` — typed task functions for Docker Compose, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { DockerComposeTasks } from "jsr:@zuke/docker-compose";
 * await DockerComposeTasks.up((s) => s.file("compose.yml").detach());
 * await DockerComposeTasks.down((s) => s.volumes());
 * ```
 *
 * Compose ships in two shapes: the v2 CLI plugin invoked as `docker compose`
 * and the legacy v1 standalone binary `docker-compose`. This wrapper detects
 * which one is installed at run time (preferring the v2 plugin) and caches the
 * result, so the same build file works on either host. Pin the form explicitly
 * with {@link DockerComposeSettings.usePlugin} or
 * {@link DockerComposeSettings.useStandalone} to skip detection.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  DockerComposeCreateSettings,
  DockerComposeDownSettings,
  DockerComposeKillSettings,
  DockerComposePauseSettings,
  DockerComposeRestartSettings,
  DockerComposeRmSettings,
  DockerComposeScaleSettings,
  DockerComposeStartSettings,
  DockerComposeStopSettings,
  DockerComposeUnpauseSettings,
  DockerComposeUpSettings,
  DockerComposeWaitSettings,
} from "./lifecycle.ts";
import {
  DockerComposeBuildSettings,
  DockerComposePullSettings,
  DockerComposePushSettings,
} from "./images.ts";
import {
  DockerComposeCommitSettings,
  DockerComposeConfigSettings,
  DockerComposeCpSettings,
  DockerComposeExecSettings,
  DockerComposeExportSettings,
  DockerComposeLogsSettings,
  DockerComposePsSettings,
  DockerComposeRunSettings,
  DockerComposeTopSettings,
} from "./containers.ts";
import {
  DockerComposeEventsSettings,
  DockerComposeImagesSettings,
  DockerComposeLsSettings,
  DockerComposePortSettings,
  DockerComposeVersionSettings,
  DockerComposeVolumesSettings,
} from "./inventory.ts";
import {
  type DockerComposeVersion,
  parseComposeVersion,
  parsePublishedPort,
  waitStatus,
} from "./reports.ts";

/** The shape of {@link DockerComposeTasks}. */
export interface DockerComposeTasksApi {
  /** Create and start services: `compose up`. */
  up(configure?: Configure<DockerComposeUpSettings>): Promise<CommandOutput>;
  /** Stop and remove services: `compose down`. */
  down(
    configure?: Configure<DockerComposeDownSettings>,
  ): Promise<CommandOutput>;
  /** Build service images: `compose build`. */
  build(
    configure?: Configure<DockerComposeBuildSettings>,
  ): Promise<CommandOutput>;
  /** Pull service images: `compose pull`. */
  pull(
    configure?: Configure<DockerComposePullSettings>,
  ): Promise<CommandOutput>;
  /** Push service images: `compose push`. */
  push(
    configure?: Configure<DockerComposePushSettings>,
  ): Promise<CommandOutput>;
  /** Run a one-off command: `compose run`. */
  run(configure?: Configure<DockerComposeRunSettings>): Promise<CommandOutput>;
  /** Exec into a running service: `compose exec`. */
  exec(
    configure?: Configure<DockerComposeExecSettings>,
  ): Promise<CommandOutput>;
  /** View service logs: `compose logs`. */
  logs(
    configure?: Configure<DockerComposeLogsSettings>,
  ): Promise<CommandOutput>;
  /** List containers: `compose ps`. */
  ps(configure?: Configure<DockerComposePsSettings>): Promise<CommandOutput>;
  /** Render the resolved configuration: `compose config`. */
  config(
    configure?: Configure<DockerComposeConfigSettings>,
  ): Promise<CommandOutput>;
  /** Start existing services: `compose start`. */
  start(
    configure?: Configure<DockerComposeStartSettings>,
  ): Promise<CommandOutput>;
  /** Stop running services: `compose stop`. */
  stop(
    configure?: Configure<DockerComposeStopSettings>,
  ): Promise<CommandOutput>;
  /** Restart services: `compose restart`. */
  restart(
    configure?: Configure<DockerComposeRestartSettings>,
  ): Promise<CommandOutput>;
  /** Remove stopped service containers: `compose rm`. */
  rm(configure?: Configure<DockerComposeRmSettings>): Promise<CommandOutput>;
  /** Create containers without starting them: `compose create`. */
  create(
    configure?: Configure<DockerComposeCreateSettings>,
  ): Promise<CommandOutput>;
  /** Force-stop service containers: `compose kill`. */
  kill(
    configure?: Configure<DockerComposeKillSettings>,
  ): Promise<CommandOutput>;
  /** Pause services: `compose pause`. */
  pause(
    configure?: Configure<DockerComposePauseSettings>,
  ): Promise<CommandOutput>;
  /** Resume paused services: `compose unpause`. */
  unpause(
    configure?: Configure<DockerComposeUnpauseSettings>,
  ): Promise<CommandOutput>;
  /** Set service replica counts: `compose scale`. */
  scale(
    configure?: Configure<DockerComposeScaleSettings>,
  ): Promise<CommandOutput>;
  /**
   * Block until services stop: `compose wait`.
   *
   * Keeps the ordinary contract — a non-zero container status fails the
   * target. Use {@link DockerComposeTasksApi.waitExitCode} when the status is
   * the answer rather than a failure.
   */
  wait(
    configure?: Configure<DockerComposeWaitSettings>,
  ): Promise<CommandOutput>;
  /** Copy between a service container and the local filesystem: `compose cp`. */
  cp(configure?: Configure<DockerComposeCpSettings>): Promise<CommandOutput>;
  /** Show running processes: `compose top`. */
  top(configure?: Configure<DockerComposeTopSettings>): Promise<CommandOutput>;
  /** Export a container filesystem as a tar archive: `compose export`. */
  export(
    configure?: Configure<DockerComposeExportSettings>,
  ): Promise<CommandOutput>;
  /** Create an image from a container: `compose commit`. */
  commit(
    configure?: Configure<DockerComposeCommitSettings>,
  ): Promise<CommandOutput>;
  /** List the images the containers use: `compose images`. */
  images(
    configure?: Configure<DockerComposeImagesSettings>,
  ): Promise<CommandOutput>;
  /** List the project's volumes: `compose volumes`. */
  volumes(
    configure?: Configure<DockerComposeVolumesSettings>,
  ): Promise<CommandOutput>;
  /** List Compose projects: `compose ls`. */
  ls(configure?: Configure<DockerComposeLsSettings>): Promise<CommandOutput>;
  /** Report the Compose version: `compose version`. */
  version(
    configure?: Configure<DockerComposeVersionSettings>,
  ): Promise<CommandOutput>;
  /** Print a published port binding: `compose port`. */
  port(
    configure?: Configure<DockerComposePortSettings>,
  ): Promise<CommandOutput>;
  /** Stream container events: `compose events`. */
  events(
    configure?: Configure<DockerComposeEventsSettings>,
  ): Promise<CommandOutput>;
  /**
   * The exit status the waited-on container stopped with.
   *
   * `compose wait` exits with the container's own status, so every code is a
   * legitimate answer and none is left to mean "compose broke". This hands the
   * code back rather than failing the target, and still fails when compose
   * never reached a container at all.
   */
  waitExitCode(
    configure?: Configure<DockerComposeWaitSettings>,
  ): Promise<number>;
  /**
   * The host port a service's container port was published on.
   *
   * The point of letting Compose pick an ephemeral port is asking which one it
   * picked, which is what this returns.
   */
  servicePort(
    configure?: Configure<DockerComposePortSettings>,
  ): Promise<number>;
  /** The installed Compose version, parsed from `compose version --format json`. */
  composeVersion(
    configure?: Configure<DockerComposeVersionSettings>,
  ): Promise<DockerComposeVersion>;
}

/** Typed task functions for Docker Compose (`docker compose`/`docker-compose`). */
export const DockerComposeTasks: DockerComposeTasksApi = {
  up(
    configure?: Configure<DockerComposeUpSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeUpSettings(), configure);
  },
  down(
    configure?: Configure<DockerComposeDownSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeDownSettings(), configure);
  },
  build(
    configure?: Configure<DockerComposeBuildSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeBuildSettings(), configure);
  },
  pull(
    configure?: Configure<DockerComposePullSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePullSettings(), configure);
  },
  push(
    configure?: Configure<DockerComposePushSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePushSettings(), configure);
  },
  run(
    configure?: Configure<DockerComposeRunSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRunSettings(), configure);
  },
  exec(
    configure?: Configure<DockerComposeExecSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeExecSettings(), configure);
  },
  logs(
    configure?: Configure<DockerComposeLogsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeLogsSettings(), configure);
  },
  ps(
    configure?: Configure<DockerComposePsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePsSettings(), configure);
  },
  config(
    configure?: Configure<DockerComposeConfigSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeConfigSettings(), configure);
  },
  start(
    configure?: Configure<DockerComposeStartSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeStartSettings(), configure);
  },
  stop(
    configure?: Configure<DockerComposeStopSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeStopSettings(), configure);
  },
  restart(
    configure?: Configure<DockerComposeRestartSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRestartSettings(), configure);
  },
  rm(
    configure?: Configure<DockerComposeRmSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRmSettings(), configure);
  },
  create(
    configure?: Configure<DockerComposeCreateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeCreateSettings(), configure);
  },
  kill(
    configure?: Configure<DockerComposeKillSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeKillSettings(), configure);
  },
  pause(
    configure?: Configure<DockerComposePauseSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePauseSettings(), configure);
  },
  unpause(
    configure?: Configure<DockerComposeUnpauseSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeUnpauseSettings(), configure);
  },
  scale(
    configure?: Configure<DockerComposeScaleSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeScaleSettings(), configure);
  },
  wait(
    configure?: Configure<DockerComposeWaitSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeWaitSettings(), configure);
  },
  cp(configure?: Configure<DockerComposeCpSettings>): Promise<CommandOutput> {
    return runSettings(new DockerComposeCpSettings(), configure);
  },
  top(
    configure?: Configure<DockerComposeTopSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeTopSettings(), configure);
  },
  export(
    configure?: Configure<DockerComposeExportSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeExportSettings(), configure);
  },
  commit(
    configure?: Configure<DockerComposeCommitSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeCommitSettings(), configure);
  },
  images(
    configure?: Configure<DockerComposeImagesSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeImagesSettings(), configure);
  },
  volumes(
    configure?: Configure<DockerComposeVolumesSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeVolumesSettings(), configure);
  },
  ls(configure?: Configure<DockerComposeLsSettings>): Promise<CommandOutput> {
    return runSettings(new DockerComposeLsSettings(), configure);
  },
  version(
    configure?: Configure<DockerComposeVersionSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeVersionSettings(), configure);
  },
  port(
    configure?: Configure<DockerComposePortSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePortSettings(), configure);
  },
  events(
    configure?: Configure<DockerComposeEventsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeEventsSettings(), configure);
  },
  async waitExitCode(
    configure?: Configure<DockerComposeWaitSettings>,
  ): Promise<number> {
    const settings = new DockerComposeWaitSettings();
    configure?.(settings);
    // noThrow so a non-zero container status reaches the reader as data; the
    // reader still fails when compose never reached a container.
    return waitStatus(await settings.noThrow().run());
  },
  async servicePort(
    configure?: Configure<DockerComposePortSettings>,
  ): Promise<number> {
    const settings = new DockerComposePortSettings();
    configure?.(settings);
    return parsePublishedPort((await settings.quiet().run()).stdout);
  },
  async composeVersion(
    configure?: Configure<DockerComposeVersionSettings>,
  ): Promise<DockerComposeVersion> {
    const settings = new DockerComposeVersionSettings();
    configure?.(settings);
    return parseComposeVersion((await settings.json().quiet().run()).stdout);
  },
};
