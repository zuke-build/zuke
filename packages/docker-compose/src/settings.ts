// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The base every Compose subcommand's settings class is built on: the project
 * and file selection, the invocation form, and the argv assembly they share.
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { resolveComposeInvocation } from "./invocation.ts";

/**
 * Base for all Compose subcommand settings. Holds the invocation prefix
 * (`docker compose` vs `docker-compose`) and the global options that precede
 * every subcommand (`-f`, `-p`, `--profile`, …), and resolves the prefix at
 * run time unless it was pinned with {@link usePlugin}/{@link useStandalone}.
 */
export abstract class DockerComposeSettings extends ToolSettings {
  #invocation: string[] = ["docker", "compose"];
  #detect = true;
  #files: string[] = [];
  #projectName?: string;
  #profiles: string[] = [];
  #projectDirectory?: string;
  #envFile?: string;

  /** The resolved binary (`docker` or `docker-compose`) for error messages. */
  protected override defaultTool(): string {
    return this.#invocation[0] ?? "docker";
  }

  /** Add a Compose file (`-f`); repeatable, order-significant. */
  file(path: PathLike): this {
    this.#files.push("-f", String(path));
    return this;
  }

  /** Set the project name (`-p`). */
  projectName(name: string): this {
    this.#projectName = name;
    return this;
  }

  /** Enable a service profile (`--profile`); repeatable. */
  profile(name: string): this {
    this.#profiles.push("--profile", name);
    return this;
  }

  /** Set the project working directory (`--project-directory`). */
  projectDirectory(path: PathLike): this {
    this.#projectDirectory = String(path);
    return this;
  }

  /** Load environment from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Force the v2 plugin form (`docker compose`) and skip detection. */
  usePlugin(): this {
    this.#invocation = ["docker", "compose"];
    this.#detect = false;
    return this;
  }

  /** Force the v1 standalone form (`docker-compose`) and skip detection. */
  useStandalone(): this {
    this.#invocation = ["docker-compose"];
    this.#detect = false;
    return this;
  }

  /** The subcommand argv (without global options). Must be pure — no I/O. */
  protected abstract composeArgs(): string[];

  /** Assemble the global options followed by the subcommand argv. */
  protected override buildArgs(): string[] {
    const argv = this.#invocation.slice(1);
    argv.push(...this.#files);
    if (this.#projectName !== undefined) argv.push("-p", this.#projectName);
    argv.push(...this.#profiles);
    if (this.#projectDirectory !== undefined) {
      argv.push("--project-directory", this.#projectDirectory);
    }
    if (this.#envFile !== undefined) argv.push("--env-file", this.#envFile);
    argv.push(...this.composeArgs());
    return argv;
  }

  /**
   * Resolve the invocation prefix (unless pinned) and run, so the same build
   * works against either the v2 plugin or the v1 standalone binary.
   */
  override async run(): Promise<CommandOutput> {
    if (this.#detect) this.#invocation = await resolveComposeInvocation();
    return super.run();
  }
}

/**
 * The `--index` flag that picks one replica of a scaled service.
 *
 * `cp`, `export`, `commit` and `port` all take it with the same meaning and
 * the same rendering, so they hold one of these rather than four copies of
 * the field and the `argv.push` that goes with it. Each still exposes its own
 * setter, because the public surface is per-command.
 */
export class ReplicaIndex {
  #index?: number;

  /** Record the replica to act on. */
  set(value: number): void {
    this.#index = value;
  }

  /** The flag, if one was set. */
  render(): string[] {
    return this.#index === undefined ? [] : ["--index", String(this.#index)];
  }
}
