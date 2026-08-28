// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that report on, or reclaim, the daemon itself:
 * `docker info`, `version`, and `system prune|df`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.system((s) => s.prune().all().force()); // reclaim disk in CI
 * await DockerTasks.version((s) => s.format("{{.Server.Version}}"));
 * ```
 *
 * @module
 */

import { DockerSettings } from "./settings.ts";

/** Settings for `docker info`. */
export class DockerInfoSettings extends DockerSettings {
  #format?: string;

  /** Render through a Go template (`--format`), e.g. `{{json .}}`. */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Assemble the `docker info` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["info"];
    if (this.#format !== undefined) argv.push("--format", this.#format);
    return argv;
  }
}

/** Settings for `docker version`. */
export class DockerVersionSettings extends DockerSettings {
  #format?: string;

  /**
   * Render through a Go template (`--format`), e.g. `{{.Server.Version}}` to
   * read just the daemon's version.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Assemble the `docker version` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["version"];
    if (this.#format !== undefined) argv.push("--format", this.#format);
    return argv;
  }
}

/** Which `docker system` subcommand a {@link DockerSystemSettings} runs. */
type SystemMode = "prune" | "df" | "info";

/**
 * Settings for `docker system`. Pick the subcommand with {@link prune},
 * {@link df}, or {@link info}.
 */
export class DockerSystemSettings extends DockerSettings {
  #mode?: SystemMode;
  #all = false;
  #force = false;
  #volumes = false;
  #filters: string[] = [];
  #verbose = false;
  #format?: string;

  /** Reclaim space (`system prune`). */
  prune(): this {
    this.#mode = "prune";
    return this;
  }

  /** Report what is using disk (`system df`). */
  df(): this {
    this.#mode = "df";
    return this;
  }

  /** Describe the daemon (`system info`). */
  info(): this {
    this.#mode = "info";
    return this;
  }

  /**
   * Prune every unused image, not only the dangling ones (`--all`) — the
   * difference between reclaiming a little space and reclaiming a lot.
   */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Do not prompt for confirmation (`--force`), which a build always needs. */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Also remove unused volumes (`--volumes`), which a prune otherwise keeps. */
  volumes(): this {
    this.#volumes = true;
    return this;
  }

  /** Limit what is pruned (`--filter`), e.g. `until=24h`; repeatable. */
  filter(...expressions: string[]): this {
    this.#filters.push(...expressions);
    return this;
  }

  /** Break the `df` report down per object (`-v`/`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Render through a Go template (`--format`). */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Assemble the `docker system` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "DockerTasks.system: no subcommand — call .prune(), .df(), or " +
          ".info().",
      );
    }
    if (this.#mode !== "prune" && (this.#all || this.#volumes || this.#force)) {
      throw new Error(
        `DockerTasks.system: .all()/.volumes()/.force() describe a prune, ` +
          `which \`system ${this.#mode}\` does not do — drop them, or call ` +
          `.prune().`,
      );
    }
    const argv = ["system", this.#mode];
    if (this.#all) argv.push("--all");
    if (this.#volumes) argv.push("--volumes");
    if (this.#force) argv.push("--force");
    for (const expression of this.#filters) argv.push("--filter", expression);
    if (this.#verbose) argv.push("--verbose");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    return argv;
  }
}
