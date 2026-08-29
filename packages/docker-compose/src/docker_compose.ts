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
  DockerComposeDownSettings,
  DockerComposeRestartSettings,
  DockerComposeRmSettings,
  DockerComposeStartSettings,
  DockerComposeStopSettings,
  DockerComposeUpSettings,
} from "./lifecycle.ts";
import {
  DockerComposeBuildSettings,
  DockerComposePullSettings,
  DockerComposePushSettings,
} from "./images.ts";
import {
  DockerComposeConfigSettings,
  DockerComposeExecSettings,
  DockerComposeLogsSettings,
  DockerComposePsSettings,
  DockerComposeRunSettings,
} from "./containers.ts";

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
};
