// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that start a process: `docker run`, `docker create`, and
 * `docker exec`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.run((s) => s.rm().image("alpine:3.20").commandArgs("echo", "hi"));
 * await DockerTasks.create((s) => s.image("app:latest").name("app"));
 * await DockerTasks.exec((s) => s.container("app").commandArgs("sh", "-c", "ls"));
 * ```
 *
 * `run` is `create` plus starting it, and both configure a container the same
 * way, so the flags they share live in one base rather than three copies:
 * {@link DockerProcessSettings} for what `exec` shares too (environment,
 * working directory, user, a TTY), and {@link DockerContainerSettings} for
 * what only a new container takes (image, name, ports, volumes, network).
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";

/**
 * Base for the commands that run a process — `run`, `create`, and `exec` —
 * carrying the flags all three accept.
 */
export abstract class DockerProcessSettings extends DockerSettings {
  #interactive = false;
  #tty = false;
  #env: string[] = [];
  #envFiles: string[] = [];
  #workdir?: string;
  #user?: string;
  #commandArgs: string[] = [];

  /** Keep stdin open (`-i`). */
  interactive(): this {
    this.#interactive = true;
    return this;
  }

  /** Allocate a pseudo-TTY (`-t`). */
  tty(): this {
    this.#tty = true;
    return this;
  }

  /** Set an environment variable (`-e`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** Read environment variables from a file (`--env-file`); repeatable. */
  envFile(...paths: PathLike[]): this {
    for (const path of paths) this.#envFiles.push("--env-file", String(path));
    return this;
  }

  /** Set the working directory inside the container (`-w`). */
  workdir(path: PathLike): this {
    this.#workdir = String(path);
    return this;
  }

  /** Run as this user or `uid:gid` (`-u`/`--user`). */
  user(value: string): this {
    this.#user = value;
    return this;
  }

  /** The command and arguments to run inside the container. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  /** The `-i`/`-t` flags, which every one of these commands renders first. */
  protected ttyArgs(): string[] {
    const argv: string[] = [];
    if (this.#interactive) argv.push("-i");
    if (this.#tty) argv.push("-t");
    return argv;
  }

  /** The environment, working directory, and user flags. */
  protected processArgs(): string[] {
    const argv = [...this.#env, ...this.#envFiles];
    if (this.#workdir !== undefined) argv.push("-w", this.#workdir);
    if (this.#user !== undefined) argv.push("-u", this.#user);
    return argv;
  }

  /** The trailing command, after the container or image it runs in. */
  protected trailingCommand(): string[] {
    return [...this.#commandArgs];
  }
}

/**
 * Base for `run` and `create`, which configure a *new* container identically —
 * docker's own `run` is `create` followed by `start`.
 */
export abstract class DockerContainerSettings extends DockerProcessSettings {
  #image?: string;
  #name?: string;
  #rm = false;
  #detach = false;
  #publish: string[] = [];
  #volumes: string[] = [];
  #network?: string;
  #entrypoint?: string;
  #platform?: string;
  #pull?: string;
  #restart?: string;
  #labels: string[] = [];

  /** The image to run (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Name the container (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Remove the container when it exits (`--rm`). */
  rm(): this {
    this.#rm = true;
    return this;
  }

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Publish a container port to the host (`-p`); repeatable. */
  publish(host: string | number, container: string | number): this {
    this.#publish.push("-p", `${host}:${container}`);
    return this;
  }

  /** Mount a host path into the container (`-v`); repeatable. */
  volume(source: PathLike, target: PathLike): this {
    this.#volumes.push("-v", `${String(source)}:${String(target)}`);
    return this;
  }

  /** Attach the container to a network (`--network`). */
  network(value: string): this {
    this.#network = value;
    return this;
  }

  /** Override the image's entrypoint (`--entrypoint`). */
  entrypoint(command: string): this {
    this.#entrypoint = command;
    return this;
  }

  /** Run the image for a specific platform (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** When to pull the image (`--pull=<always|missing|never>`). */
  pull(policy: "always" | "missing" | "never"): this {
    this.#pull = policy;
    return this;
  }

  /** The restart policy (`--restart`), e.g. `unless-stopped`. */
  restart(policy: string): this {
    this.#restart = policy;
    return this;
  }

  /** Attach metadata to the container (`--label`); repeatable. */
  label(key: string, value: string): this {
    this.#labels.push("--label", `${key}=${value}`);
    return this;
  }

  /**
   * Assemble everything after the subcommand: the flags, the image, and the
   * command. `run` and `create` differ only in the token in front of this.
   */
  protected containerArgs(task: string): string[] {
    if (this.#image === undefined) {
      throw new Error(`DockerTasks.${task}: .image() is required.`);
    }
    const argv: string[] = [];
    if (this.#rm) argv.push("--rm");
    if (this.#detach) argv.push("-d");
    argv.push(...this.ttyArgs());
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#network !== undefined) argv.push("--network", this.#network);
    if (this.#entrypoint !== undefined) {
      argv.push("--entrypoint", this.#entrypoint);
    }
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#pull !== undefined) argv.push(`--pull=${this.#pull}`);
    if (this.#restart !== undefined) argv.push("--restart", this.#restart);
    argv.push(...this.#labels);
    argv.push(...this.processArgs(), ...this.#publish, ...this.#volumes);
    argv.push(this.#image, ...this.trailingCommand());
    return argv;
  }
}

/** Settings for `docker run`. */
export class DockerRunSettings extends DockerContainerSettings {
  /** Assemble the `docker run` argv. */
  protected override subcommandArgs(): string[] {
    return ["run", ...this.containerArgs("run")];
  }
}

/** Settings for `docker create`. */
export class DockerCreateSettings extends DockerContainerSettings {
  /** Assemble the `docker create` argv. */
  protected override subcommandArgs(): string[] {
    return ["create", ...this.containerArgs("create")];
  }
}

/** Settings for `docker exec`. */
export class DockerExecSettings extends DockerProcessSettings {
  #container?: string;
  #detach = false;
  #privileged = false;

  /** The container to run the command in (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Run the command in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Give the command extended privileges (`--privileged`). */
  privileged(): this {
    this.#privileged = true;
    return this;
  }

  /** Assemble the `docker exec` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.exec: .container() is required.");
    }
    const argv = ["exec"];
    if (this.#detach) argv.push("-d");
    argv.push(...this.ttyArgs());
    if (this.#privileged) argv.push("--privileged");
    argv.push(...this.processArgs());
    argv.push(this.#container, ...this.trailingCommand());
    return argv;
  }
}
