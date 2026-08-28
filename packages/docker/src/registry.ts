// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that talk to a registry rather than to the daemon:
 * `docker login`, `logout`, and `search`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.login((s) => s.registry("ghcr.io").username(user).passwordStdin(token));
 * await DockerTasks.logout((s) => s.registry("ghcr.io"));
 * ```
 *
 * @module
 */

import { DockerSettings } from "./settings.ts";

/** Settings for `docker login`. */
export class DockerLoginSettings extends DockerSettings {
  #username?: string;
  #password?: string;
  #passwordStdin = false;
  #registry?: string;

  /** The username (`-u`). */
  username(value: string): this {
    this.#username = value;
    return this;
  }

  /**
   * The password (`-p`). This lands directly in the process argv, where it
   * can leak through `ps`/process listings, shell history, or CI job logs —
   * {@link passwordStdin} is the safe choice in CI (and generally), since it
   * pipes the secret through STDIN instead of putting it on the command line.
   */
  password(value: string): this {
    this.#password = value;
    return this;
  }

  /** Read the password from STDIN (`--password-stdin`). */
  passwordStdin(): this {
    this.#passwordStdin = true;
    return this;
  }

  /** The registry server (defaults to Docker Hub). */
  registry(server: string): this {
    this.#registry = server;
    return this;
  }

  /** Assemble the `docker login` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["login"];
    if (this.#username !== undefined) argv.push("-u", this.#username);
    if (this.#password !== undefined) argv.push("-p", this.#password);
    if (this.#passwordStdin) argv.push("--password-stdin");
    if (this.#registry !== undefined) argv.push(this.#registry);
    return argv;
  }
}

/** Settings for `docker logout`. */
export class DockerLogoutSettings extends DockerSettings {
  #registry?: string;

  /** The registry to forget (positional); defaults to Docker Hub. */
  registry(server: string): this {
    this.#registry = server;
    return this;
  }

  /** Assemble the `docker logout` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["logout"];
    if (this.#registry !== undefined) argv.push(this.#registry);
    return argv;
  }
}

/** Settings for `docker search`. */
export class DockerSearchSettings extends DockerSettings {
  #term?: string;
  #limit?: number;
  #filters: string[] = [];
  #format?: string;
  #noTrunc = false;

  /** What to search Docker Hub for (required). */
  term(value: string): this {
    this.#term = value;
    return this;
  }

  /** Cap the number of results (`--limit`). */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** Filter the results (`--filter`), e.g. `is-official=true`; repeatable. */
  filter(...expressions: string[]): this {
    this.#filters.push(...expressions);
    return this;
  }

  /** Render each result through a Go template (`--format`). */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Print descriptions in full (`--no-trunc`). */
  noTrunc(): this {
    this.#noTrunc = true;
    return this;
  }

  /** Assemble the `docker search` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#term === undefined) {
      throw new Error("DockerTasks.search: .term() is required.");
    }
    const argv = ["search"];
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    for (const expression of this.#filters) argv.push("--filter", expression);
    if (this.#noTrunc) argv.push("--no-trunc");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(this.#term);
    return argv;
  }
}
