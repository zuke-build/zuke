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

/**
 * Settings for `deno serve`.
 *
 * A server runs until it is stopped, so a build target that awaits this task
 * blocks forever. Give it a bound with `.killAfter(ms)` — for a smoke test
 * that the server starts — or run it from a target the build is not waiting
 * on.
 */
export class DenoServeSettings extends DenoPermissionSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #port?: number;
  #host?: string;
  #parallel = false;
  #open = false;
  #watch = false;
  #config?: string;

  /** The module exporting the server's default handler (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the server module (after the module path). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** The TCP port to serve on (`--port`); `0` picks a free one. */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** The TCP address to serve on (`--host`), defaulting to all interfaces. */
  host(value: string): this {
    this.#host = value;
    return this;
  }

  /**
   * Run one server worker per available CPU (`--parallel`), or as many as
   * `DENO_JOBS` allows.
   */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Open a browser on the served address (`--open`). */
  open(): this {
    this.#open = true;
    return this;
  }

  /** Restart the server when a watched file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno serve` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("DenoTasks.serve: .script() is required.");
    }
    const argv = ["serve", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (this.#parallel) argv.push("--parallel");
    if (this.#open) argv.push("--open");
    if (this.#watch) argv.push("--watch");
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** A content type `deno eval` and `deno bench` accept for `--ext`. */
export type DenoSourceExt =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "mts"
  | "mjs"
  | "cts"
  | "cjs";

/**
 * Settings for `deno eval`.
 *
 * The code is passed as a single argv entry by the shell layer, never
 * interpolated into a command string, so a value built from build parameters
 * cannot break out of it.
 */
export class DenoEvalSettings extends DenoPermissionSettings {
  #code?: string;
  #print = false;
  #ext?: DenoSourceExt;
  #config?: string;

  /** The source to evaluate (required). */
  code(source: string): this {
    this.#code = source;
    return this;
  }

  /** Print the expression's result to stdout (`--print`). */
  print(): this {
    this.#print = true;
    return this;
  }

  /** Treat the source as this content type (`--ext`), rather than TypeScript. */
  ext(value: DenoSourceExt): this {
    this.#ext = value;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `deno eval` argv. */
  protected override buildArgs(): string[] {
    if (this.#code === undefined) {
      throw new Error("DenoTasks.eval: .code() is required.");
    }
    const argv = ["eval", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#ext !== undefined) argv.push("--ext", this.#ext);
    if (this.#print) argv.push("--print");
    argv.push(this.#code);
    return argv;
  }
}
