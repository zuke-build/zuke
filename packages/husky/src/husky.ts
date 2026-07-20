/**
 * `HuskyTasks` — typed task functions for the [`husky`](https://typicode.github.io/husky)
 * Git-hooks tool, in the same settings-lambda style as the other Zuke tool
 * wrappers: configure a fluent settings object in a lambda, and the task
 * function builds the command line and executes it.
 *
 * ```ts
 * import { HuskyTasks } from "jsr:@zuke/husky";
 * await HuskyTasks.init();
 * await HuskyTasks.install();
 * ```
 *
 * Targets husky v9+. In v9 the only subcommand is `init`; the legacy `install`
 * subcommand was removed, and hooks are installed by invoking `husky` bare (an
 * optional directory may follow). Arguments stay a discrete argv array
 * end-to-end — never a concatenated shell string — so command construction is
 * injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Shared base for every `husky` invocation: the binary and argv assembly. */
export abstract class HuskySettings extends ToolSettings {
  /** The tool binary is `husky`. */
  protected override defaultTool(): string {
    return "husky";
  }

  /** The subcommand argv (everything after the binary). */
  protected abstract subcommandArgs(): string[];

  /** Assemble the full `husky` argv from the subcommand argv. */
  protected override buildArgs(): string[] {
    return this.subcommandArgs();
  }
}

/**
 * Settings for `husky init [dir]` — scaffold husky in a project: create the
 * hooks directory, add a sample `pre-commit` hook, and wire up the `prepare`
 * script. This is the canonical husky v9 setup command.
 */
export class HuskyInitSettings extends HuskySettings {
  #dir?: string;

  /** The hooks directory to initialise (positional; defaults to `.husky`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Assemble the `husky init [dir]` subcommand argv. */
  protected override subcommandArgs(): string[] {
    return ["init", ...(this.#dir !== undefined ? [this.#dir] : [])];
  }
}

/**
 * Settings for installing Git hooks by invoking `husky [dir]` bare.
 *
 * husky v9 **removed** the old `install` subcommand: running `husky` with no
 * subcommand is what installs the hooks (an optional directory may follow).
 * This task therefore emits the bare `husky` invocation — its default argv is
 * just `["husky"]`, not `["husky", "install"]`.
 */
export class HuskyInstallSettings extends HuskySettings {
  #dir?: string;

  /** The hooks directory to install into (positional; defaults to `.husky`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Assemble the bare `husky [dir]` invocation argv (no subcommand). */
  protected override subcommandArgs(): string[] {
    return [...(this.#dir !== undefined ? [this.#dir] : [])];
  }
}

/** The shape of {@link HuskyTasks}. */
export interface HuskyTasksApi {
  /** Scaffold husky in a project: `husky init [dir]`. */
  init(configure?: Configure<HuskyInitSettings>): Promise<CommandOutput>;
  /**
   * Install Git hooks via the bare `husky [dir]` invocation (husky v9 removed
   * the `install` subcommand).
   */
  install(configure?: Configure<HuskyInstallSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `husky` Git-hooks tool. */
export const HuskyTasks: HuskyTasksApi = {
  init: (c) => runSettings(new HuskyInitSettings(), c),
  install: (c) => runSettings(new HuskyInstallSettings(), c),
};
