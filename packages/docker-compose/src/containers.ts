// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the Compose subcommands that reach into containers or report on
 * them: `run`, `exec`, `logs`, `ps` and `config`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DockerComposeSettings } from "./settings.ts";

/** Settings for `compose run`. */
export class DockerComposeRunSettings extends DockerComposeSettings {
  #service?: string;
  #rm = false;
  #detach = false;
  #noDeps = false;
  #name?: string;
  #env: string[] = [];
  #commandArgs: string[] = [];

  /** The service to run (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** Remove the container after it exits (`--rm`). */
  rm(): this {
    this.#rm = true;
    return this;
  }

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Do not start linked services (`--no-deps`). */
  noDeps(): this {
    this.#noDeps = true;
    return this;
  }

  /** Assign a container name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Set an environment variable (`-e KEY=value`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** The command and arguments to run inside the container. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `compose run` argv. */
  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.run: .service() is required.");
    }
    const argv = ["run"];
    if (this.#rm) argv.push("--rm");
    if (this.#detach) argv.push("-d");
    if (this.#noDeps) argv.push("--no-deps");
    if (this.#name !== undefined) argv.push("--name", this.#name);
    argv.push(...this.#env, this.#service, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `compose exec`. */
export class DockerComposeExecSettings extends DockerComposeSettings {
  #service?: string;
  #detach = false;
  #noTty = false;
  #workdir?: string;
  #env: string[] = [];
  #commandArgs: string[] = [];

  /** The service whose container to exec into (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Disable pseudo-TTY allocation (`-T`). */
  noTty(): this {
    this.#noTty = true;
    return this;
  }

  /** Working directory inside the container (`-w`). */
  workdir(path: PathLike): this {
    this.#workdir = String(path);
    return this;
  }

  /** Set an environment variable (`-e KEY=value`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** The command and arguments to execute. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `compose exec` argv. */
  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.exec: .service() is required.");
    }
    const argv = ["exec"];
    if (this.#detach) argv.push("-d");
    if (this.#noTty) argv.push("-T");
    if (this.#workdir !== undefined) argv.push("-w", this.#workdir);
    argv.push(...this.#env, this.#service, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `compose logs`. */
export class DockerComposeLogsSettings extends DockerComposeSettings {
  #follow = false;
  #timestamps = false;
  #tail?: string;
  #services: string[] = [];

  /** Stream new log output (`-f`). */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** Prefix each line with a timestamp (`-t`). */
  timestamps(): this {
    this.#timestamps = true;
    return this;
  }

  /** Show only the last N lines, or `all` (`--tail`). */
  tail(lines: number | "all"): this {
    this.#tail = String(lines);
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose logs` argv. */
  protected override composeArgs(): string[] {
    const argv = ["logs"];
    if (this.#follow) argv.push("-f");
    if (this.#timestamps) argv.push("-t");
    if (this.#tail !== undefined) argv.push("--tail", this.#tail);
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose ps`. */
export class DockerComposePsSettings extends DockerComposeSettings {
  #all = false;
  #quiet = false;
  #services = false;
  #serviceNames: string[] = [];

  /** Show stopped containers too (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show container IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Display services instead of containers (`--services`). */
  servicesOnly(): this {
    this.#services = true;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#serviceNames.push(...names);
    return this;
  }

  /** Assemble the `compose ps` argv. */
  protected override composeArgs(): string[] {
    const argv = ["ps"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    if (this.#services) argv.push("--services");
    argv.push(...this.#serviceNames);
    return argv;
  }
}

/** Settings for `compose config`. */
export class DockerComposeConfigSettings extends DockerComposeSettings {
  #quiet = false;
  #servicesOnly = false;
  #volumesOnly = false;
  #format?: string;

  /** Only validate, printing nothing (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Print the service names only (`--services`). */
  servicesOnly(): this {
    this.#servicesOnly = true;
    return this;
  }

  /** Print the volume names only (`--volumes`). */
  volumesOnly(): this {
    this.#volumesOnly = true;
    return this;
  }

  /** Output format (`--format`), e.g. `yaml` or `json`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Assemble the `compose config` argv. */
  protected override composeArgs(): string[] {
    const argv = ["config"];
    if (this.#quiet) argv.push("-q");
    if (this.#servicesOnly) argv.push("--services");
    if (this.#volumesOnly) argv.push("--volumes");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    return argv;
  }
}
