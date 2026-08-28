// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git reset` — moving the branch, the index, and (with `--hard`) the working
 * tree back to a commit.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.reset((s) => s.hard().ref("origin/main")); // discard everything local
 * await GitTasks.reset((s) => s.paths("dist"));             // unstage some paths
 * ```
 *
 * The mode and a pathspec are mutually exclusive — git refuses `--hard` with
 * paths — so this refuses the combination by name rather than passing it on.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** How far back a {@link GitResetSettings} rewinds. */
type ResetMode = "soft" | "mixed" | "hard" | "merge" | "keep";

/** Settings for `git reset`. */
export class GitResetSettings extends GitSettings {
  #mode?: ResetMode;
  #ref?: string;
  #paths: string[] = [];

  /** The commit to reset to (positional); defaults to `HEAD`. */
  ref(rev: string): this {
    this.#ref = rev;
    return this;
  }

  /** Reset only these pathspecs — unstaging them (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Move the branch only, keeping the index and working tree (`--soft`). */
  soft(): this {
    this.#mode = "soft";
    return this;
  }

  /** Reset the index but not the working tree (`--mixed`), git's default. */
  mixed(): this {
    this.#mode = "mixed";
    return this;
  }

  /** Reset the index *and* the working tree (`--hard`), discarding changes. */
  hard(): this {
    this.#mode = "hard";
    return this;
  }

  /** Reset, keeping changes to files that differ between the commits (`--merge`). */
  merge(): this {
    this.#mode = "merge";
    return this;
  }

  /** Like {@link merge}, but refuse when a changed file differs (`--keep`). */
  keep(): this {
    this.#mode = "keep";
    return this;
  }

  /** Assemble the `git reset` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode !== undefined && this.#paths.length > 0) {
      throw new Error(
        `GitTasks.reset: --${this.#mode} resets the whole tree, so git refuses ` +
          `a pathspec alongside it — drop the mode to unstage paths, or drop ` +
          `.paths(...).`,
      );
    }
    const argv = ["reset"];
    if (this.#mode !== undefined) argv.push(`--${this.#mode}`);
    if (this.#ref !== undefined) argv.push(this.#ref);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
