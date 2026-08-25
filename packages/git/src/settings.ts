// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link GitSettings} — the base every `git` subcommand's settings extend: the
 * `git` binary itself and the global options that precede any subcommand
 * (`-C <path>`, `-c key=value`).
 *
 * It lives apart from the subcommands so a subcommand in its own module (see
 * `worktree.ts`) can extend it without importing the module that assembles
 * `GitTasks`, which would import it back.
 *
 * @module
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";

/** Shared base for every `git` subcommand: the binary and global options. */
export abstract class GitSettings extends ToolSettings {
  #dir?: string;
  #configs: string[] = [];

  /** The default tool binary: `git`. */
  protected override defaultTool(): string {
    return "git";
  }

  /** The subcommand argv (after the global options). */
  protected abstract subcommandArgs(): string[];

  /** Run git as if started in `path` (`-C <path>`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Set a one-off config value (`-c key=value`); repeatable. */
  config(key: string, value: string): this {
    this.#configs.push("-c", `${key}=${value}`);
    return this;
  }

  /** Assemble the `git` argv: global options followed by the subcommand. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#dir !== undefined) argv.push("-C", this.#dir);
    argv.push(...this.#configs);
    argv.push(...this.subcommandArgs());
    return argv;
  }
}
