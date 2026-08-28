// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `docker context` — the named daemons a build can talk to.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.context((s) => s.create("remote").dockerHost("ssh://build@host"));
 * await DockerTasks.context((s) => s.use("remote"));
 * ```
 *
 * Prefer `.dockerContext(name)` on the task itself for a one-off: it scopes a
 * single command, where `context use` changes what every later command talks
 * to, including ones outside the build.
 *
 * @module
 */

import { DockerSettings } from "./settings.ts";

/** Which `docker context` subcommand a {@link DockerContextSettings} runs. */
type ContextMode = "create" | "ls" | "use" | "inspect" | "rm" | "show";

/**
 * Settings for `docker context`. Pick the subcommand with {@link create},
 * {@link ls}, {@link use}, {@link inspect}, {@link remove}, or {@link show}.
 */
export class DockerContextSettings extends DockerSettings {
  #mode: ContextMode = "ls";
  #names: string[] = [];
  #dockerHost?: string;
  #description?: string;
  #from?: string;
  #format?: string;
  #quiet = false;
  #force = false;

  /** Create a context (`context create <name>`). */
  create(name: string): this {
    this.#mode = "create";
    this.#names = [name];
    return this;
  }

  /** List contexts (`context ls`), the default. */
  ls(): this {
    this.#mode = "ls";
    this.#names = [];
    return this;
  }

  /** Make a context the default for later commands (`context use <name>`). */
  use(name: string): this {
    this.#mode = "use";
    this.#names = [name];
    return this;
  }

  /** Describe contexts (`context inspect [<name>...]`). */
  inspect(...names: string[]): this {
    this.#mode = "inspect";
    this.#names = names;
    return this;
  }

  /** Remove contexts (`context rm <name>...`). */
  remove(...names: string[]): this {
    this.#mode = "rm";
    this.#names = names;
    return this;
  }

  /** Print the context in use (`context show`). */
  show(): this {
    this.#mode = "show";
    this.#names = [];
    return this;
  }

  /** The daemon a created context points at (`--docker host=<address>`). */
  dockerHost(address: string): this {
    this.#dockerHost = address;
    return this;
  }

  /** A human description for a created context (`--description`). */
  description(text: string): this {
    this.#description = text;
    return this;
  }

  /** Copy an existing context (`--from <name>`). */
  from(name: string): this {
    this.#from = name;
    return this;
  }

  /** Render each context through a Go template (`--format`). */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Only print context names (`-q`/`--quiet`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Remove even the context in use (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `docker context` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === "rm" && this.#names.length === 0) {
      throw new Error(
        "DockerTasks.context: .remove(...) needs at least one context name.",
      );
    }
    const argv = ["context", this.#mode];
    if (this.#dockerHost !== undefined) {
      argv.push("--docker", `host=${this.#dockerHost}`);
    }
    if (this.#description !== undefined) {
      argv.push("--description", this.#description);
    }
    if (this.#from !== undefined) argv.push("--from", this.#from);
    if (this.#quiet) argv.push("--quiet");
    if (this.#force) argv.push("--force");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#names);
    return argv;
  }
}
