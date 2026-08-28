// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `docker network` — the user-defined networks that let a test container
 * reach the service it is testing by name, without publishing a port.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.network((s) => s.create("test-net"));
 * await DockerTasks.network((s) => s.connect("test-net", "db"));
 * const networks = await DockerTasks.networkNames();
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";
import { parseLines } from "./json_lines.ts";

/** Which `docker network` subcommand a {@link DockerNetworkSettings} runs. */
type NetworkMode =
  | "create"
  | "ls"
  | "rm"
  | "inspect"
  | "connect"
  | "disconnect"
  | "prune";

/**
 * Settings for `docker network`. Pick the subcommand with {@link create},
 * {@link ls}, {@link remove}, {@link inspect}, {@link connect},
 * {@link disconnect}, or {@link prune}.
 */
export class DockerNetworkSettings extends DockerSettings {
  #mode: NetworkMode = "ls";
  #args: string[] = [];
  #driver?: string;
  #subnet?: string;
  #gateway?: string;
  #labels: string[] = [];
  #filters: string[] = [];
  #format?: string;
  #quiet = false;
  #force = false;
  #alias?: string;

  /** Create a network (`network create <name>`). */
  create(name: string): this {
    this.#mode = "create";
    this.#args = [name];
    return this;
  }

  /** List networks (`network ls`), the default. */
  ls(): this {
    this.#mode = "ls";
    this.#args = [];
    return this;
  }

  /** Remove networks (`network rm <name>...`). */
  remove(...names: string[]): this {
    this.#mode = "rm";
    this.#args = names;
    return this;
  }

  /** Describe networks (`network inspect <name>...`). */
  inspect(...names: string[]): this {
    this.#mode = "inspect";
    this.#args = names;
    return this;
  }

  /** Attach a container to a network (`network connect <net> <container>`). */
  connect(network: string, container: string): this {
    this.#mode = "connect";
    this.#args = [network, container];
    return this;
  }

  /** Detach a container (`network disconnect <net> <container>`). */
  disconnect(network: string, container: string): this {
    this.#mode = "disconnect";
    this.#args = [network, container];
    return this;
  }

  /** Remove the networks nothing uses (`network prune`). */
  prune(): this {
    this.#mode = "prune";
    this.#args = [];
    return this;
  }

  /** The network driver (`--driver`), e.g. `bridge`. */
  driver(name: string): this {
    this.#driver = name;
    return this;
  }

  /** The subnet in CIDR form (`--subnet`). */
  subnet(cidr: string): this {
    this.#subnet = cidr;
    return this;
  }

  /** The gateway address (`--gateway`). */
  gateway(address: string): this {
    this.#gateway = address;
    return this;
  }

  /** Attach metadata (`--label`); repeatable. */
  label(key: string, value: string): this {
    this.#labels.push("--label", `${key}=${value}`);
    return this;
  }

  /** An extra name the container answers to on this network (`--alias`). */
  alias(name: string): this {
    this.#alias = name;
    return this;
  }

  /** Filter a listing or a prune (`--filter`); repeatable. */
  filter(...expressions: string[]): this {
    this.#filters.push(...expressions);
    return this;
  }

  /**
   * Render each network through a Go template (`--format`).
   * {@link "./docker.ts".DockerTasks.networkNames} pins `{{.Name}}`.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Only print network ids (`-q`/`--quiet`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Do not prompt for confirmation (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `docker network` argv. */
  protected override subcommandArgs(): string[] {
    if (
      (this.#mode === "rm" || this.#mode === "inspect") &&
      this.#args.length === 0
    ) {
      throw new Error(
        `DockerTasks.network: .${
          this.#mode === "rm" ? "remove" : "inspect"
        }(...) needs at least one network name.`,
      );
    }
    if (this.#alias !== undefined && this.#mode !== "connect") {
      throw new Error(
        `DockerTasks.network: .alias(...) names a container on a network it ` +
          `is joining, which \`network ${this.#mode}\` does not do — drop it, ` +
          `or call .connect(...).`,
      );
    }
    const argv = ["network", this.#mode];
    if (this.#driver !== undefined) argv.push("--driver", this.#driver);
    if (this.#subnet !== undefined) argv.push("--subnet", this.#subnet);
    if (this.#gateway !== undefined) argv.push("--gateway", this.#gateway);
    if (this.#alias !== undefined) argv.push("--alias", this.#alias);
    argv.push(...this.#labels);
    for (const expression of this.#filters) argv.push("--filter", expression);
    if (this.#quiet) argv.push("--quiet");
    if (this.#force) argv.push("--force");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#args);
    return argv;
  }
}

/**
 * Run `docker network ls --format '{{.Name}}'` and split the names out. Backs
 * {@link "./docker.ts".DockerTasks.networkNames}.
 */
export async function readNetworkNames(
  configure?: Configure<DockerNetworkSettings>,
): Promise<string[]> {
  const settings = new DockerNetworkSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.ls().format("{{.Name}}").run();
  return parseLines(output.stdout);
}
