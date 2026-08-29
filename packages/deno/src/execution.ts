// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that execute code a project already
 * defines: `run` and `task`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";

/** Settings for `deno run`. */
export class DenoRunSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #config?: string;
  #reload = false;

  /** The script to run (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the script (after the script path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Reload the module cache (`--reload`). */
  reload(): this {
    this.#reload = true;
    return this;
  }

  /** Assemble the `deno run` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.run: .script() is required.");
    }
    const argv = ["run", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#reload) argv.push("--reload");
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `deno task`. */
export class DenoTaskSettings extends DenoSettings {
  #name?: string;
  #taskArgs: string[] = [];
  #frozen = false;

  /** The task name from deno.json (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Arguments forwarded to the task. */
  taskArgs(...args: Array<string | number>): this {
    this.#taskArgs.push(...args.map(String));
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** Assemble the `deno task` argv. */
  protected override buildArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error("DenoTasks.task: .name() is required.");
    }
    const argv = ["task"];
    if (this.#frozen) argv.push("--frozen");
    argv.push(this.#name, ...this.#taskArgs);
    return argv;
  }
}
