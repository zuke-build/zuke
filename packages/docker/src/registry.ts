// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that talk to a registry rather than to the daemon:
 * `docker login`, `logout`, and `search`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.login((s) =>
 *   s.registry("ghcr.io").username(user).passwordStdin(token)
 * );
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
  #stdinPassword?: string;
  #registry?: string;

  /** The username (`-u`). */
  username(value: string): this {
    this.#username = value;
    return this;
  }

  /**
   * The password (`-p`), which docker accepts and which therefore stays on the
   * wrapper.
   *
   * Prefer {@link passwordStdin}. This flag puts the password in the child's
   * argv, and a child's argv is world-readable on a default Linux host —
   * through `ps` or `/proc/<pid>/cmdline` — to every other user on the machine
   * and every process the build starts. On a shared or self-hosted runner that
   * is every co-tenant.
   *
   * The value is registered with the run's redactor, so Zuke's own renderings
   * of the command mask it. That does not cover the process table: the argv
   * handed to the operating system is not redacted, and docker itself warns
   * about `-p` for the same reason. Masking is what can be done here, not a
   * fix for the exposure.
   */
  password(value: string): this {
    this.#password = value;
    this.markSecret(value);
    return this;
  }

  /**
   * Pipe the password to docker through STDIN (`--password-stdin`), which
   * keeps it off the command line entirely.
   *
   * This is the route docker documents for exactly this reason, and the one to
   * use in CI. The token goes to the child's standard input, which — unlike its
   * argv — no other process on the host can read.
   *
   * The password is required, because the flag on its own means nothing: it
   * tells docker to read standard input, and this wrapper is what has to put
   * something there. A `--password-stdin` with no writer leaves docker reading
   * a stream that is never written.
   */
  passwordStdin(token: string): this {
    this.#stdinPassword = token;
    this.markSecret(token);
    return this;
  }

  /** The registry server (defaults to Docker Hub). */
  registry(server: string): this {
    this.#registry = server;
    return this;
  }

  /**
   * The password given to {@link passwordStdin}, handed to the child on its
   * standard input. `undefined` when that setter was never called, which is
   * what leaves stdin alone for every other login.
   */
  protected override stdinInput(): string | undefined {
    return this.#stdinPassword;
  }

  /** Assemble the `docker login` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["login"];
    if (this.#username !== undefined) argv.push("-u", this.#username);
    if (this.#password !== undefined) argv.push("-p", this.#password);
    // The flag only, never the token: the token travels on stdin.
    if (this.#stdinPassword !== undefined) argv.push("--password-stdin");
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
