// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that bring a repository into existence: `git init` and
 * `git clone`.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.init((s) => s.initialBranch("main"));
 * await GitTasks.clone((s) => s.repository(url).directory("work").depth(1));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git init`. */
export class GitInitSettings extends GitSettings {
  #bare = false;
  #initialBranch?: string;

  /** Create a bare repository (`--bare`). */
  bare(): this {
    this.#bare = true;
    return this;
  }

  /** Name the initial branch (`-b`/`--initial-branch`). */
  initialBranch(name: string): this {
    this.#initialBranch = name;
    return this;
  }

  /** Assemble the `git init` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["init"];
    if (this.#bare) argv.push("--bare");
    if (this.#initialBranch !== undefined) {
      argv.push("-b", this.#initialBranch);
    }
    return argv;
  }
}

/** Settings for `git clone`. */
export class GitCloneSettings extends GitSettings {
  #repository?: string;
  #directory?: string;
  #branch?: string;
  #depth?: number;
  #bare = false;
  #filter?: string;
  #recurseSubmodules = false;
  #singleBranch = false;

  /** The repository URL to clone (required). */
  repository(url: string): this {
    this.#repository = url;
    return this;
  }

  /** Target directory for the clone. */
  directory(path: PathLike): this {
    this.#directory = String(path);
    return this;
  }

  /** Check out a specific branch (`-b`/`--branch`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Create a shallow clone of the given depth (`--depth`). */
  depth(commits: number): this {
    this.#depth = commits;
    return this;
  }

  /** Clone a bare repository (`--bare`). */
  bare(): this {
    this.#bare = true;
    return this;
  }

  /**
   * Partial-clone filter (`--filter=<spec>`), e.g. `blob:none` for a treeless
   * clone that fetches blobs on demand — the cheap way to get full history in
   * CI without the file contents of every revision.
   */
  filter(spec: string): this {
    this.#filter = spec;
    return this;
  }

  /** Clone only the history of the checked-out branch (`--single-branch`). */
  singleBranch(): this {
    this.#singleBranch = true;
    return this;
  }

  /** Also clone submodules (`--recurse-submodules`). */
  recurseSubmodules(): this {
    this.#recurseSubmodules = true;
    return this;
  }

  /** Assemble the `git clone` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#repository === undefined) {
      throw new Error("GitTasks.clone: .repository() is required.");
    }
    const argv = ["clone"];
    if (this.#branch !== undefined) argv.push("-b", this.#branch);
    if (this.#depth !== undefined) argv.push("--depth", String(this.#depth));
    if (this.#singleBranch) argv.push("--single-branch");
    if (this.#filter !== undefined) argv.push(`--filter=${this.#filter}`);
    if (this.#recurseSubmodules) argv.push("--recurse-submodules");
    if (this.#bare) argv.push("--bare");
    argv.push(this.#repository);
    if (this.#directory !== undefined) argv.push(this.#directory);
    return argv;
  }
}
