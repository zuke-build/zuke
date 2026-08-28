// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that move a container through its life: `docker start`,
 * `stop`, `restart`, `kill`, `pause`, `unpause`, `rm`, `wait`, `rename`, and
 * `update`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.restart((s) => s.containers("app").timeout(5));
 * const exitCode = await DockerTasks.wait((s) => s.containers("app"));
 * await DockerTasks.rm((s) => s.containers("app").force().volumes());
 * ```
 *
 * Most of these take the same list of containers, so that list — and the
 * refusal to run one of them with an empty list, which docker reports as a
 * bare usage dump — lives in {@link DockerContainerListSettings}.
 *
 * @module
 */

import { DockerSettings } from "./settings.ts";

/**
 * Base for the commands that act on one or more existing containers. The
 * empty-list check is here so every one of them reports the same thing rather
 * than letting docker print its usage.
 */
export abstract class DockerContainerListSettings extends DockerSettings {
  #containers: string[] = [];

  /** Container names or ids to act on (required); repeatable. */
  containers(...names: string[]): this {
    this.#containers.push(...names);
    return this;
  }

  /** The container list, after refusing an empty one. */
  protected containerList(task: string): string[] {
    if (this.#containers.length === 0) {
      throw new Error(
        `DockerTasks.${task}: at least one container is required.`,
      );
    }
    return [...this.#containers];
  }
}

/** Settings for `docker stop`. */
export class DockerStopSettings extends DockerContainerListSettings {
  #time?: number;

  /** Seconds to wait before killing (`-t`). */
  time(seconds: number): this {
    this.#time = seconds;
    return this;
  }

  /** Assemble the `docker stop` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["stop"];
    if (this.#time !== undefined) argv.push("-t", String(this.#time));
    argv.push(...this.containerList("stop"));
    return argv;
  }
}

/** Settings for `docker start`. */
export class DockerStartSettings extends DockerContainerListSettings {
  #attach = false;

  /** Attach STDOUT/STDERR and forward signals (`-a`). */
  attach(): this {
    this.#attach = true;
    return this;
  }

  /** Assemble the `docker start` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["start"];
    if (this.#attach) argv.push("-a");
    argv.push(...this.containerList("start"));
    return argv;
  }
}

/** Settings for `docker rm`. */
export class DockerRmSettings extends DockerContainerListSettings {
  #force = false;
  #volumes = false;

  /** Force removal of a running container (`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Also remove anonymous volumes (`-v`). */
  volumes(): this {
    this.#volumes = true;
    return this;
  }

  /** Assemble the `docker rm` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["rm"];
    if (this.#force) argv.push("-f");
    if (this.#volumes) argv.push("-v");
    argv.push(...this.containerList("rm"));
    return argv;
  }
}

/** Settings for `docker restart`. */
export class DockerRestartSettings extends DockerContainerListSettings {
  #timeout?: number;
  #signal?: string;

  /** Seconds to wait before killing the container (`-t`/`--time`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** The signal to send first (`-s`/`--signal`). */
  signal(name: string): this {
    this.#signal = name;
    return this;
  }

  /** Assemble the `docker restart` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["restart"];
    if (this.#signal !== undefined) argv.push("--signal", this.#signal);
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    argv.push(...this.containerList("restart"));
    return argv;
  }
}

/** Settings for `docker kill`. */
export class DockerKillSettings extends DockerContainerListSettings {
  #signal?: string;

  /** The signal to send (`-s`/`--signal`); docker defaults to `SIGKILL`. */
  signal(name: string): this {
    this.#signal = name;
    return this;
  }

  /** Assemble the `docker kill` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["kill"];
    if (this.#signal !== undefined) argv.push("--signal", this.#signal);
    argv.push(...this.containerList("kill"));
    return argv;
  }
}

/** Settings for `docker pause`. */
export class DockerPauseSettings extends DockerContainerListSettings {
  /** Assemble the `docker pause` argv. */
  protected override subcommandArgs(): string[] {
    return ["pause", ...this.containerList("pause")];
  }
}

/** Settings for `docker unpause`. */
export class DockerUnpauseSettings extends DockerContainerListSettings {
  /** Assemble the `docker unpause` argv. */
  protected override subcommandArgs(): string[] {
    return ["unpause", ...this.containerList("unpause")];
  }
}

/**
 * Settings for `docker wait` — blocking until the containers stop, then
 * printing their exit codes, which is how a build gets a test container's
 * result rather than the runner's.
 */
export class DockerWaitSettings extends DockerContainerListSettings {
  /** Assemble the `docker wait` argv. */
  protected override subcommandArgs(): string[] {
    return ["wait", ...this.containerList("wait")];
  }
}

/** Settings for `docker rename`. */
export class DockerRenameSettings extends DockerSettings {
  #container?: string;
  #newName?: string;

  /** The container to rename (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Its new name (required). */
  newName(name: string): this {
    this.#newName = name;
    return this;
  }

  /** Assemble the `docker rename` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined || this.#newName === undefined) {
      throw new Error(
        "DockerTasks.rename: .container(...) and .newName(...) are both " +
          "required.",
      );
    }
    return ["rename", this.#container, this.#newName];
  }
}

/** Settings for `docker update`. */
export class DockerUpdateSettings extends DockerContainerListSettings {
  #memory?: string;
  #cpus?: string;
  #restart?: string;

  /** The memory limit (`--memory`), e.g. `512m`. */
  memory(limit: string): this {
    this.#memory = limit;
    return this;
  }

  /** How many CPUs the container may use (`--cpus`). */
  cpus(count: string): this {
    this.#cpus = count;
    return this;
  }

  /** The restart policy (`--restart`). */
  restart(policy: string): this {
    this.#restart = policy;
    return this;
  }

  /** Assemble the `docker update` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["update"];
    if (this.#memory !== undefined) argv.push("--memory", this.#memory);
    if (this.#cpus !== undefined) argv.push("--cpus", this.#cpus);
    if (this.#restart !== undefined) argv.push("--restart", this.#restart);
    argv.push(...this.containerList("update"));
    return argv;
  }
}
