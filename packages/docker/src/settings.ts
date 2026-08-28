// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link DockerSettings} — the base every `docker` subcommand's settings
 * extend: the `docker` binary and the global options that must precede the
 * subcommand.
 *
 * docker parses `--context`, `--host`, `--log-level`, `--config`, and
 * `--debug` before it reads the subcommand, so they cannot simply be appended
 * the way another CLI's config flags can. Holding them here means every task
 * can reach a second daemon or a named context, and only one place has to know
 * where in the argv they belong.
 *
 * @module
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";

/** How verbose the docker client is (`--log-level`). */
export type DockerLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/** Shared base for every `docker` subcommand: the binary and global options. */
export abstract class DockerSettings extends ToolSettings {
  #context?: string;
  #host?: string;
  #logLevel?: DockerLogLevel;
  #config?: string;
  #debug = false;

  /** The invoked binary is `docker`. */
  protected override defaultTool(): string {
    return "docker";
  }

  /** The subcommand argv, after the global options. */
  protected abstract subcommandArgs(): string[];

  /**
   * Use a named docker context (`--context`), which is how a build talks to a
   * remote daemon or a second local one without exporting `DOCKER_HOST`.
   *
   * Named `dockerContext` rather than `context` because `docker build`'s
   * trailing `PATH` is *also* called a context, and
   * {@link "./build.ts".DockerBuildSettings.context} already means that one.
   */
  dockerContext(name: string): this {
    this.#context = name;
    return this;
  }

  /** The daemon socket to connect to (`--host`), e.g. `ssh://build@host`. */
  host(address: string): this {
    this.#host = address;
    return this;
  }

  /** How much the client logs (`--log-level`). */
  logLevel(level: DockerLogLevel): this {
    this.#logLevel = level;
    return this;
  }

  /** Where the client config lives (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Enable client debug output (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  /**
   * Assemble the `docker` argv: the global options, then the subcommand.
   * docker reads these before the subcommand, so the order is not cosmetic —
   * `docker ps --context x` is an error, `docker --context x ps` is not.
   */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#context !== undefined) argv.push("--context", this.#context);
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (this.#logLevel !== undefined) argv.push("--log-level", this.#logLevel);
    if (this.#debug) argv.push("--debug");
    argv.push(...this.subcommandArgs());
    return argv;
  }
}
