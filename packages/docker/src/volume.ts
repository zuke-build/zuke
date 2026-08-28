// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `docker volume` — the named volumes a build creates for a cache or a
 * database fixture, and removes again afterwards.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.volume((s) => s.create("build-cache"));
 * const volumes = await DockerTasks.volumeNames();
 * await DockerTasks.volume((s) => s.remove("build-cache").force());
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";
import { parseLines } from "./json_lines.ts";

/** Which `docker volume` subcommand a {@link DockerVolumeSettings} runs. */
type VolumeMode = "create" | "ls" | "rm" | "inspect" | "prune";

/**
 * Settings for `docker volume`. Pick the subcommand with {@link create},
 * {@link ls}, {@link remove}, {@link inspect}, or {@link prune}.
 */
export class DockerVolumeSettings extends DockerSettings {
  #mode: VolumeMode = "ls";
  #names: string[] = [];
  #driver?: string;
  #labels: string[] = [];
  #options: string[] = [];
  #filters: string[] = [];
  #format?: string;
  #quiet = false;
  #force = false;
  #all = false;

  /** Create a volume (`volume create [<name>]`). */
  create(name?: string): this {
    this.#mode = "create";
    this.#names = name === undefined ? [] : [name];
    return this;
  }

  /** List volumes (`volume ls`), the default. */
  ls(): this {
    this.#mode = "ls";
    this.#names = [];
    return this;
  }

  /** Remove volumes (`volume rm <name>...`). */
  remove(...names: string[]): this {
    this.#mode = "rm";
    this.#names = names;
    return this;
  }

  /** Describe volumes (`volume inspect <name>...`). */
  inspect(...names: string[]): this {
    this.#mode = "inspect";
    this.#names = names;
    return this;
  }

  /** Remove the volumes nothing uses (`volume prune`). */
  prune(): this {
    this.#mode = "prune";
    this.#names = [];
    return this;
  }

  /** The volume driver (`--driver`), for a created volume. */
  driver(name: string): this {
    this.#driver = name;
    return this;
  }

  /** Attach metadata (`--label`); repeatable. */
  label(key: string, value: string): this {
    this.#labels.push("--label", `${key}=${value}`);
    return this;
  }

  /** A driver-specific option (`--opt`); repeatable. */
  opt(key: string, value: string): this {
    this.#options.push("--opt", `${key}=${value}`);
    return this;
  }

  /** Filter a listing or a prune (`--filter`); repeatable. */
  filter(...expressions: string[]): this {
    this.#filters.push(...expressions);
    return this;
  }

  /**
   * Render each volume through a Go template (`--format`).
   * {@link "./docker.ts".DockerTasks.volumeNames} pins `{{.Name}}`.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Only print volume names (`-q`/`--quiet`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Do not prompt, and remove even a volume in use where docker allows it (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Prune anonymous *and* named volumes (`--all`), not only anonymous ones. */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `docker volume` argv. */
  protected override subcommandArgs(): string[] {
    if (
      (this.#mode === "rm" || this.#mode === "inspect") &&
      this.#names.length === 0
    ) {
      throw new Error(
        `DockerTasks.volume: .${
          this.#mode === "rm" ? "remove" : "inspect"
        }(...) needs at least one volume name.`,
      );
    }
    const argv = ["volume", this.#mode];
    if (this.#driver !== undefined) argv.push("--driver", this.#driver);
    argv.push(...this.#labels, ...this.#options);
    for (const expression of this.#filters) argv.push("--filter", expression);
    if (this.#quiet) argv.push("--quiet");
    if (this.#all) argv.push("--all");
    if (this.#force) argv.push("--force");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#names);
    return argv;
  }
}

/**
 * Run `docker volume ls --format '{{.Name}}'` and split the names out. Backs
 * {@link "./docker.ts".DockerTasks.volumeNames}.
 */
export async function readVolumeNames(
  configure?: Configure<DockerVolumeSettings>,
): Promise<string[]> {
  const settings = new DockerVolumeSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.ls().format("{{.Name}}").run();
  return parseLines(output.stdout);
}
