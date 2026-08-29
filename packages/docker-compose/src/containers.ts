// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the Compose subcommands that reach into containers or report on
 * them: `run`, `exec`, `logs`, `ps` and `config`.
 */

import type { PathLike } from "@zuke/core/tooling";
import {
  DockerComposeSettings,
  ReplicaIndex,
  ServiceList,
} from "./settings.ts";

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

/**
 * Settings for `compose cp`.
 *
 * Compose copies between a service container and the local filesystem, so
 * exactly one side names a service. Naming both or neither is refused rather
 * than handed to Compose as a path it cannot resolve.
 */
export class DockerComposeCpSettings extends DockerComposeSettings {
  #from?: string;
  #to?: string;
  #fromIsService = false;
  #toIsService = false;
  #index = new ReplicaIndex();
  #all = false;
  #archive = false;
  #followLink = false;

  /** Copy out of `service` at `path` (`SERVICE:PATH`). */
  fromService(service: string, path: PathLike): this {
    this.#from = `${service}:${String(path)}`;
    this.#fromIsService = true;
    return this;
  }

  /** Copy out of a local path. */
  fromLocal(path: PathLike): this {
    this.#from = String(path);
    this.#fromIsService = false;
    return this;
  }

  /** Copy into `service` at `path` (`SERVICE:PATH`). */
  toService(service: string, path: PathLike): this {
    this.#to = `${service}:${String(path)}`;
    this.#toIsService = true;
    return this;
  }

  /** Copy into a local path. */
  toLocal(path: PathLike): this {
    this.#to = String(path);
    this.#toIsService = false;
    return this;
  }

  /** Pick the replica to copy from when the service has several (`--index`). */
  index(value: number): this {
    this.#index.set(value);
    return this;
  }

  /** Include containers created by `compose run` (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Preserve uid/gid information (`--archive`). */
  archive(): this {
    this.#archive = true;
    return this;
  }

  /** Follow symbolic links in the source path (`--follow-link`). */
  followLink(): this {
    this.#followLink = true;
    return this;
  }

  /** Assemble the `compose cp` argv. */
  protected override composeArgs(): string[] {
    if (this.#from === undefined || this.#to === undefined) {
      throw new Error(
        "DockerComposeTasks.cp: both ends are required — use one of " +
          ".fromService()/.fromLocal() and one of .toService()/.toLocal().",
      );
    }
    if (this.#fromIsService === this.#toIsService) {
      const both = this.#fromIsService ? "two services" : "two local paths";
      throw new Error(
        `DockerComposeTasks.cp: copying between ${both} is not what compose ` +
          "cp does — one end names a service and the other is local.",
      );
    }
    const argv = ["cp"];
    if (this.#all) argv.push("--all");
    if (this.#archive) argv.push("--archive");
    if (this.#followLink) argv.push("--follow-link");
    argv.push(...this.#index.render());
    argv.push(this.#from, this.#to);
    return argv;
  }
}

/** Settings for `compose top`. */
export class DockerComposeTopSettings extends DockerComposeSettings {
  #services = new ServiceList();

  /** Restrict the report to these services. */
  services(...names: string[]): this {
    this.#services.add(names);
    return this;
  }

  /** Assemble the `compose top` argv. */
  protected override composeArgs(): string[] {
    return ["top", ...this.#services.render()];
  }
}

/** Settings for `compose export`. */
export class DockerComposeExportSettings extends DockerComposeSettings {
  #service?: string;
  #output?: string;
  #index = new ReplicaIndex();

  /** The service whose container filesystem to export (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /**
   * Write the tar archive to a file (`--output`) instead of stdout. Prefer it:
   * a tar stream captured as the command's stdout goes through Zuke's output
   * buffer, which is text-shaped and size-capped.
   */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Pick the replica to export when the service has several (`--index`). */
  index(value: number): this {
    this.#index.set(value);
    return this;
  }

  /** Assemble the `compose export` argv. */
  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.export: .service() is required.");
    }
    const argv = ["export"];
    if (this.#output !== undefined) argv.push("--output", this.#output);
    argv.push(...this.#index.render());
    argv.push(this.#service);
    return argv;
  }
}

/** Settings for `compose commit`. */
export class DockerComposeCommitSettings extends DockerComposeSettings {
  #service?: string;
  #reference?: string;
  #author?: string;
  #message?: string;
  #changes: string[] = [];
  #index = new ReplicaIndex();
  #noPause = false;

  /** The service whose container to commit (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The image reference to create, e.g. `my-app:test`. */
  reference(value: string): this {
    this.#reference = value;
    return this;
  }

  /** Image author (`--author`). */
  author(value: string): this {
    this.#author = value;
    return this;
  }

  /** Commit message (`--message`). */
  message(value: string): this {
    this.#message = value;
    return this;
  }

  /** Apply a Dockerfile instruction to the created image (`--change`). */
  change(...instructions: string[]): this {
    this.#changes.push(...instructions);
    return this;
  }

  /** Pick the replica to commit when the service has several (`--index`). */
  index(value: number): this {
    this.#index.set(value);
    return this;
  }

  /**
   * Leave the container running during the commit (`--pause=false`). Compose
   * pauses it by default so the filesystem cannot change mid-capture; turning
   * that off trades a consistent image for uninterrupted service.
   */
  noPause(): this {
    this.#noPause = true;
    return this;
  }

  /** Assemble the `compose commit` argv. */
  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.commit: .service() is required.");
    }
    const argv = ["commit"];
    if (this.#author !== undefined) argv.push("--author", this.#author);
    if (this.#message !== undefined) argv.push("--message", this.#message);
    for (const change of this.#changes) argv.push("--change", change);
    argv.push(...this.#index.render());
    if (this.#noPause) argv.push("--pause=false");
    argv.push(this.#service);
    if (this.#reference !== undefined) argv.push(this.#reference);
    return argv;
  }
}
