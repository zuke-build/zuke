// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git commit` — recording what is staged.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.commit((s) => s.all().message("ci: refresh generated docs"));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git commit`. */
export class GitCommitSettings extends GitSettings {
  #message?: string;
  #all = false;
  #amend = false;
  #noEdit = false;
  #allowEmpty = false;
  #noVerify = false;
  #author?: string;
  #paths: string[] = [];

  /** The commit message (`-m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Stage modified/deleted files before committing (`-a`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Amend the previous commit (`--amend`). */
  amend(): this {
    this.#amend = true;
    return this;
  }

  /** Keep the existing message when amending (`--no-edit`). */
  noEdit(): this {
    this.#noEdit = true;
    return this;
  }

  /** Allow a commit with no changes (`--allow-empty`). */
  allowEmpty(): this {
    this.#allowEmpty = true;
    return this;
  }

  /**
   * Skip the `pre-commit` and `commit-msg` hooks (`--no-verify`) — what a bot
   * commit wants when the hooks are meant for humans at a terminal.
   */
  noVerify(): this {
    this.#noVerify = true;
    return this;
  }

  /** Attribute the commit to someone else (`--author="Name <email>"`). */
  author(value: string): this {
    this.#author = value;
    return this;
  }

  /** Commit only these pathspecs (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Assemble the `git commit` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["commit"];
    if (this.#all) argv.push("--all");
    if (this.#amend) argv.push("--amend");
    if (this.#noEdit) argv.push("--no-edit");
    if (this.#allowEmpty) argv.push("--allow-empty");
    if (this.#noVerify) argv.push("--no-verify");
    if (this.#author !== undefined) argv.push(`--author=${this.#author}`);
    if (this.#message !== undefined) argv.push("-m", this.#message);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
