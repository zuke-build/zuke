// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git worktree` — the subcommand that checks a second working tree out of one
 * repository, so several branches can be worked on at once without cloning
 * again or stashing.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.worktree((s) => s.add("../feature").branch("feature").createBranch());
 * const trees = await GitTasks.worktreeList();
 * await GitTasks.worktree((s) => s.remove("../feature"));
 * ```
 *
 * {@link "./git.ts".GitTasks.worktreeList} is the one that hands back parsed
 * entries rather than raw output — a target that reports on, or cleans up,
 * existing worktrees reads them as values instead of scraping stdout.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { shortBranchName } from "./refs.ts";

/** Which `git worktree` subcommand a {@link GitWorktreeSettings} runs. */
type WorktreeMode = "add" | "list" | "remove" | "prune";

/** One entry of `git worktree list --porcelain`. */
export interface GitWorktree {
  /** The worktree's absolute path, as git reports it. */
  path: string;
  /** The commit checked out there, or `undefined` for a bare repository. */
  head?: string;
  /** The checked-out branch, without its `refs/heads/` prefix; absent when detached. */
  branch?: string;
  /** Whether this entry is the bare repository rather than a working tree. */
  bare: boolean;
  /** Whether `HEAD` is detached there. */
  detached: boolean;
  /** Whether the worktree is locked (`git worktree lock`). */
  locked: boolean;
}

/**
 * Settings for `git worktree`. Pick the subcommand with {@link add},
 * {@link list}, {@link remove}, or {@link prune}; the remaining methods apply
 * to the one picked, mirroring the flags git accepts for it.
 */
export class GitWorktreeSettings extends GitSettings {
  #mode?: WorktreeMode;
  #path?: string;
  #branch?: string;
  #startPoint?: string;
  #createBranch = false;
  #detach = false;
  #force = false;
  #porcelain = false;

  /** Check a new worktree out at `path` (`git worktree add <path>`). */
  add(path: PathLike): this {
    this.#mode = "add";
    this.#path = String(path);
    return this;
  }

  /** List the repository's worktrees (`git worktree list`). */
  list(): this {
    this.#mode = "list";
    return this;
  }

  /** Remove the worktree at `path` (`git worktree remove <path>`). */
  remove(path: PathLike): this {
    this.#mode = "remove";
    this.#path = String(path);
    return this;
  }

  /** Discard records of worktrees whose directories are gone (`git worktree prune`). */
  prune(): this {
    this.#mode = "prune";
    return this;
  }

  /**
   * The branch to check out in the new worktree — or, with
   * {@link createBranch}, the name of the branch to create there.
   */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Create {@link branch} rather than checking out an existing one (`-b`). */
  createBranch(): this {
    this.#createBranch = true;
    return this;
  }

  /**
   * The commit the new branch forks from — git's trailing `<commit-ish>`, e.g.
   * `origin/main`. Only meaningful with {@link createBranch}: without a start
   * point git branches from the *parent* checkout's `HEAD`, which is whatever
   * the developer happened to have open.
   *
   * Setting this and {@link branch} without {@link createBranch} is refused:
   * both want the same trailing position, and there is no reading of the
   * command where git would take them both.
   */
  startPoint(ref: string): this {
    this.#startPoint = ref;
    return this;
  }

  /** Check out with a detached `HEAD` (`--detach`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /**
   * Force the operation (`--force`): check out a branch already checked out
   * elsewhere, or remove a worktree with modifications. Without it git refuses
   * both.
   */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Emit the stable machine-readable listing (`--porcelain`). */
  porcelain(): this {
    this.#porcelain = true;
    return this;
  }

  /** Assemble the `git worktree` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#mode === undefined) {
      throw new Error(
        "GitTasks.worktree: no subcommand — call .add(path), .list(), " +
          ".remove(path), or .prune().",
      );
    }
    const argv = ["worktree", this.#mode];
    if (this.#mode === "list") {
      if (this.#porcelain) argv.push("--porcelain");
      return argv;
    }
    if (this.#mode === "prune") return argv;
    if (this.#force) argv.push("--force");
    if (this.#mode === "remove") return [...argv, this.#pathArg()];
    if (this.#detach) argv.push("--detach");
    if (this.#createBranch) {
      if (this.#branch === undefined) {
        throw new Error(
          "GitTasks.worktree: .createBranch() needs the name to create — " +
            "call .branch(name).",
        );
      }
      argv.push("-b", this.#branch);
    }
    argv.push(this.#pathArg());
    const commitish = this.#commitish();
    if (commitish !== undefined) argv.push(commitish);
    return argv;
  }

  /**
   * The trailing `<commit-ish>` of `worktree add`. With `-b` that is the start
   * point the new branch forks from; without it, the branch to check out there
   * — which is why a start point and a branch given *without* `-b` are refused
   * rather than one of them being dropped.
   */
  #commitish(): string | undefined {
    if (this.#createBranch) return this.#startPoint;
    if (this.#branch !== undefined && this.#startPoint !== undefined) {
      throw new Error(
        "GitTasks.worktree: .branch(...) and .startPoint(...) both want the " +
          "trailing commit-ish. Add .createBranch() to fork a new branch from " +
          "the start point, or drop one of them.",
      );
    }
    return this.#startPoint ?? this.#branch;
  }

  /** The path `add`/`remove` operate on; both set it, so this cannot be absent. */
  #pathArg(): string {
    if (this.#path === undefined) {
      throw new Error("GitTasks.worktree: no path was given.");
    }
    return this.#path;
  }
}

/**
 * Parse `git worktree list --porcelain` into entries. Records are separated by
 * a blank line and start with a `worktree <path>` line; attributes that carry
 * no value (`bare`, `detached`, `locked`) appear alone. Unknown attributes are
 * ignored, so a newer git reporting more of them still parses.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseWorktreeList(stdout: string): GitWorktree[] {
  const entries: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  const flush = () => {
    if (current !== null) entries.push(current);
    current = null;
  };
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd(); // tolerate CRLF
    if (line === "") {
      flush();
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      flush();
      current = { path: value, bare: false, detached: false, locked: false };
      continue;
    }
    // An attribute before any `worktree` line belongs to nothing; skip it.
    if (current === null) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = shortBranchName(value);
    else if (key === "bare") current.bare = true;
    else if (key === "detached") current.detached = true;
    else if (key === "locked") current.locked = true;
  }
  flush();
  return entries;
}
