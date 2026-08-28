// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git stash` — parking uncommitted work and getting it back.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.stash((s) => s.push().message("before regen").includeUntracked());
 * await GitTasks.stash((s) => s.pop());
 * await GitTasks.stash((s) => s.list());
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Which `git stash` subcommand a {@link GitStashSettings} runs. */
type StashMode = "push" | "pop" | "apply" | "list" | "show" | "drop" | "clear";

/**
 * Settings for `git stash`. Pick the subcommand with {@link push},
 * {@link pop}, {@link apply}, {@link list}, {@link show}, {@link drop}, or
 * {@link clear}; the remaining methods apply to the one picked.
 */
export class GitStashSettings extends GitSettings {
  #mode?: StashMode;
  #stash?: string;
  #message?: string;
  #includeUntracked = false;
  #keepIndex = false;
  #staged = false;
  #paths: string[] = [];

  /** Stash the working tree and index (`git stash push`). */
  push(): this {
    this.#mode = "push";
    return this;
  }

  /** Restore a stash and drop it (`git stash pop`). */
  pop(): this {
    this.#mode = "pop";
    return this;
  }

  /** Restore a stash and keep it (`git stash apply`). */
  apply(): this {
    this.#mode = "apply";
    return this;
  }

  /** List the stashes (`git stash list`). */
  list(): this {
    this.#mode = "list";
    return this;
  }

  /** Show a stash's diff (`git stash show`). */
  show(): this {
    this.#mode = "show";
    return this;
  }

  /** Discard a stash (`git stash drop`). */
  drop(): this {
    this.#mode = "drop";
    return this;
  }

  /** Discard every stash (`git stash clear`). */
  clear(): this {
    this.#mode = "clear";
    return this;
  }

  /**
   * Which stash to act on, e.g. `stash@{1}` (positional); defaults to the most
   * recent. Only meaningful for {@link pop}, {@link apply}, {@link show}, and
   * {@link drop}.
   */
  stash(ref: string): this {
    this.#stash = ref;
    return this;
  }

  /** Label the stash being pushed (`-m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Stash untracked files too (`--include-untracked`). */
  includeUntracked(): this {
    this.#includeUntracked = true;
    return this;
  }

  /** Leave what is already staged in the index (`--keep-index`). */
  keepIndex(): this {
    this.#keepIndex = true;
    return this;
  }

  /** Stash only what is staged (`--staged`). */
  staged(): this {
    this.#staged = true;
    return this;
  }

  /** Stash only these pathspecs (positional, after `--`); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Assemble the `git stash` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "GitTasks.stash: no subcommand — call .push(), .pop(), .apply(), " +
          ".list(), .show(), .drop(), or .clear().",
      );
    }
    if (this.#mode !== "push") {
      const pushOnly = this.#includeUntracked
        ? ".includeUntracked()"
        : this.#keepIndex
        ? ".keepIndex()"
        : this.#staged
        ? ".staged()"
        : this.#message !== undefined
        ? ".message(...)"
        : this.#paths.length > 0
        ? ".paths(...)"
        : undefined;
      if (pushOnly !== undefined) {
        throw new Error(
          `GitTasks.stash: ${pushOnly} describes what to stash, which ` +
            `\`stash ${this.#mode}\` does not do — drop it.`,
        );
      }
    }
    const argv = ["stash", this.#mode];
    if (this.#mode === "push") {
      if (this.#stash !== undefined) {
        throw new Error(
          "GitTasks.stash: .stash(...) names an existing stash, which " +
            ".push() does not take — drop it.",
        );
      }
      if (this.#includeUntracked) argv.push("--include-untracked");
      if (this.#keepIndex) argv.push("--keep-index");
      if (this.#staged) argv.push("--staged");
      if (this.#message !== undefined) argv.push("-m", this.#message);
      if (this.#paths.length > 0) argv.push("--", ...this.#paths);
      return argv;
    }
    if (this.#mode === "list" || this.#mode === "clear") return argv;
    if (this.#stash !== undefined) argv.push(this.#stash);
    return argv;
  }
}
