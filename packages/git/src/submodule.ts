// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git submodule` — the repositories checked out inside this one.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.submodule((s) => s.update().withInit().recursive().depth(1));
 * await GitTasks.submodule((s) => s.status().recursive());
 * ```
 *
 * `update --init --recursive` is the one a CI checkout almost always needs:
 * without `--init` a freshly cloned submodule is an empty directory, and the
 * build fails on a missing file rather than on a missing checkout.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Which `git submodule` subcommand a {@link GitSubmoduleSettings} runs. */
type SubmoduleMode =
  | "add"
  | "init"
  | "deinit"
  | "update"
  | "sync"
  | "status"
  | "foreach";

/**
 * Settings for `git submodule`. Pick the subcommand with {@link add},
 * {@link init}, {@link deinit}, {@link update}, {@link sync}, {@link status},
 * or {@link foreach}.
 */
export class GitSubmoduleSettings extends GitSettings {
  #mode?: SubmoduleMode;
  #url?: string;
  #branch?: string;
  #command: string[] = [];
  #paths: string[] = [];
  #withInit = false;
  #recursive = false;
  #remote = false;
  #force = false;
  #depth?: number;
  #jobs?: number;

  /** Add a submodule (`git submodule add <url> [<path>]`). */
  add(url: string, path?: PathLike): this {
    this.#mode = "add";
    this.#url = url;
    if (path !== undefined) this.#paths = [String(path)];
    return this;
  }

  /** Register the submodules in `.gitmodules` (`git submodule init`). */
  init(): this {
    this.#mode = "init";
    return this;
  }

  /** Unregister submodules (`git submodule deinit`). */
  deinit(): this {
    this.#mode = "deinit";
    return this;
  }

  /** Check the submodules out at their recorded commits (`git submodule update`). */
  update(): this {
    this.#mode = "update";
    return this;
  }

  /** Copy the configured URLs into `.git/config` (`git submodule sync`). */
  sync(): this {
    this.#mode = "sync";
    return this;
  }

  /** Report each submodule's checked-out commit (`git submodule status`). */
  status(): this {
    this.#mode = "status";
    return this;
  }

  /** Run a command in each submodule (`git submodule foreach <command>`). */
  foreach(...command: string[]): this {
    this.#mode = "foreach";
    this.#command = command;
    return this;
  }

  /** Limit the operation to these paths (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /**
   * Initialise uninitialised submodules first (`--init`), the flag
   * {@link update} needs on a fresh clone. Named for the flag rather than the
   * `init` subcommand, which is what {@link init} runs.
   */
  withInit(): this {
    this.#withInit = true;
    return this;
  }

  /** Recurse into nested submodules (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Use the upstream branch's latest commit rather than the recorded one (`--remote`). */
  remote(): this {
    this.#remote = true;
    return this;
  }

  /** Discard local changes in the submodule (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Clone the submodules shallowly (`--depth <n>`). */
  depth(commits: number): this {
    this.#depth = commits;
    return this;
  }

  /** Clone this many submodules in parallel (`--jobs <n>`). */
  jobs(count: number): this {
    this.#jobs = count;
    return this;
  }

  /** Track this branch when adding or updating (`-b <branch>`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Assemble the `git submodule` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "GitTasks.submodule: no subcommand — call .add(url), .init(), " +
          ".deinit(), .update(), .sync(), .status(), or .foreach(...).",
      );
    }
    if (this.#mode === "foreach" && this.#command.length === 0) {
      throw new Error(
        "GitTasks.submodule: .foreach(...) needs the command to run in each " +
          "submodule.",
      );
    }
    if (this.#withInit && this.#mode !== "update") {
      throw new Error(
        "GitTasks.submodule: .withInit() is `update --init` — it only applies " +
          "to .update().",
      );
    }
    if (this.#remote && this.#mode !== "update" && this.#mode !== "add") {
      throw new Error(
        `GitTasks.submodule: .remote() tracks the upstream branch, which ` +
          `\`submodule ${this.#mode}\` does not do — drop it.`,
      );
    }
    const argv = ["submodule", this.#mode];
    if (this.#mode === "foreach") {
      if (this.#recursive) argv.push("--recursive");
      argv.push(...this.#command);
      return argv;
    }
    if (this.#withInit) argv.push("--init");
    if (this.#remote) argv.push("--remote");
    if (this.#recursive) argv.push("--recursive");
    if (this.#force) argv.push("--force");
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
    if (this.#jobs !== undefined) argv.push("--jobs", String(this.#jobs));
    if (this.#branch !== undefined) argv.push("-b", this.#branch);
    if (this.#url !== undefined) {
      // `submodule add [--] <repository> [<path>]`: the separator goes before
      // the repository, so the path that follows it is positional, not fenced
      // off by a second `--` git would read as the path itself.
      argv.push("--", this.#url, ...this.#paths);
      return argv;
    }
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
