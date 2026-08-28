// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that change what is staged or what the working tree holds:
 * `git add`, `git rm`, `git mv`, `git restore`, and `git clean`.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.add((s) => s.all());
 * await GitTasks.rm((s) => s.cached().paths("secret.env"));
 * await GitTasks.restore((s) => s.staged().paths("src"));
 * await GitTasks.clean((s) => s.force().directories());
 * ```
 *
 * Every pathspec goes after a `--` separator, so a path beginning with `-` is
 * a path and never a flag git tries to parse.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git add`. */
export class GitAddSettings extends GitSettings {
  #paths: string[] = [];
  #all = false;
  #update = false;
  #force = false;
  #intentToAdd = false;

  /** Paths/pathspecs to stage (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Stage all changes including new files (`-A`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Stage modifications and deletions, but not new files (`-u`/`--update`). */
  update(): this {
    this.#update = true;
    return this;
  }

  /** Stage files git would otherwise ignore (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /**
   * Record the paths' existence but not their contents (`-N`/`--intent-to-add`),
   * which is what makes an untracked file show up in `git diff`.
   */
  intentToAdd(): this {
    this.#intentToAdd = true;
    return this;
  }

  /** Assemble the `git add` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["add"];
    if (this.#all) argv.push("--all");
    if (this.#update) argv.push("--update");
    if (this.#force) argv.push("--force");
    if (this.#intentToAdd) argv.push("--intent-to-add");
    // `--` so a pathspec beginning with `-` (e.g. `-weird.txt`) is treated as a
    // path, not parsed by git as a flag. `add` positionals are always pathspecs.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git rm`. */
export class GitRmSettings extends GitSettings {
  #paths: string[] = [];
  #cached = false;
  #recursive = false;
  #force = false;
  #dryRun = false;
  #ignoreUnmatch = false;

  /** Paths/pathspecs to remove (positional, required); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /**
   * Remove from the index only, leaving the file on disk (`--cached`) — how a
   * file committed by mistake stops being tracked without being deleted.
   */
  cached(): this {
    this.#cached = true;
    return this;
  }

  /** Recurse into directories (`-r`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Remove even when the file has staged or local changes (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Report what would be removed without removing it (`-n`/`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Exit 0 when no path matches (`--ignore-unmatch`). */
  ignoreUnmatch(): this {
    this.#ignoreUnmatch = true;
    return this;
  }

  /** Assemble the `git rm` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error("GitTasks.rm: .paths(...) is required.");
    }
    const argv = ["rm"];
    if (this.#cached) argv.push("--cached");
    if (this.#recursive) argv.push("-r");
    if (this.#force) argv.push("--force");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#ignoreUnmatch) argv.push("--ignore-unmatch");
    argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git mv`. */
export class GitMvSettings extends GitSettings {
  #sources: string[] = [];
  #destination?: string;
  #force = false;
  #dryRun = false;

  /** The path(s) to move (positional, required); repeatable. */
  sources(...values: PathLike[]): this {
    this.#sources.push(...values.map(String));
    return this;
  }

  /**
   * Where they move to (required): a file name for a single source, a
   * directory when there is more than one.
   */
  destination(path: PathLike): this {
    this.#destination = String(path);
    return this;
  }

  /** Overwrite an existing destination (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Report what would move without moving it (`-n`/`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Assemble the `git mv` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#sources.length === 0 || this.#destination === undefined) {
      throw new Error(
        "GitTasks.mv: .sources(...) and .destination(...) are both required.",
      );
    }
    const argv = ["mv"];
    if (this.#force) argv.push("--force");
    if (this.#dryRun) argv.push("--dry-run");
    // `git mv` takes no `--` before its sources on every supported git, so the
    // paths are positional; the destination is always last.
    argv.push(...this.#sources, this.#destination);
    return argv;
  }
}

/** Settings for `git restore`. */
export class GitRestoreSettings extends GitSettings {
  #paths: string[] = [];
  #source?: string;
  #staged = false;
  #worktree = false;

  /** The pathspecs to restore (positional, required); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /**
   * Restore the contents from this commit or tree (`--source=<tree-ish>`)
   * rather than from the index.
   */
  source(treeish: string): this {
    this.#source = treeish;
    return this;
  }

  /**
   * Restore the index (`--staged`) — unstaging the paths. Combine with
   * {@link worktree} to reset both, which is what `git restore -SW` does.
   */
  staged(): this {
    this.#staged = true;
    return this;
  }

  /** Restore the working tree (`--worktree`), git's default when neither is given. */
  worktree(): this {
    this.#worktree = true;
    return this;
  }

  /** Assemble the `git restore` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error("GitTasks.restore: .paths(...) is required.");
    }
    const argv = ["restore"];
    if (this.#source !== undefined) argv.push(`--source=${this.#source}`);
    if (this.#staged) argv.push("--staged");
    if (this.#worktree) argv.push("--worktree");
    argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git clean`. */
export class GitCleanSettings extends GitSettings {
  #paths: string[] = [];
  #force = false;
  #dryRun = false;
  #directories = false;
  #includeIgnored = false;
  #onlyIgnored = false;
  #excludes: string[] = [];

  /** Limit the clean to these pathspecs (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Actually delete the files (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** List what would be deleted without deleting it (`-n`/`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Also remove untracked directories (`-d`). */
  directories(): this {
    this.#directories = true;
    return this;
  }

  /**
   * Remove ignored files too (`-x`) — the switch that turns a clean into a
   * from-scratch build, since `node_modules` and `target/` are ignored.
   */
  includeIgnored(): this {
    this.#includeIgnored = true;
    return this;
  }

  /** Remove *only* ignored files (`-X`), keeping other untracked ones. */
  onlyIgnored(): this {
    this.#onlyIgnored = true;
    return this;
  }

  /** Spare paths matching this pattern (`--exclude=<pattern>`); repeatable. */
  exclude(...patterns: string[]): this {
    this.#excludes.push(...patterns);
    return this;
  }

  /** Assemble the `git clean` argv. */
  protected override subcommandArgs(): string[] {
    if (!this.#force && !this.#dryRun) {
      throw new Error(
        "GitTasks.clean: git refuses to delete without .force() — add it, or " +
          "call .dryRun() to see what would go.",
      );
    }
    if (this.#includeIgnored && this.#onlyIgnored) {
      throw new Error(
        "GitTasks.clean: .includeIgnored() (-x) and .onlyIgnored() (-X) are " +
          "opposites — pick one.",
      );
    }
    const argv = ["clean"];
    if (this.#force) argv.push("--force");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#directories) argv.push("-d");
    if (this.#includeIgnored) argv.push("-x");
    if (this.#onlyIgnored) argv.push("-X");
    for (const pattern of this.#excludes) argv.push(`--exclude=${pattern}`);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
