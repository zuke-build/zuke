// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git merge-tree` — performing a merge in memory, without touching the index
 * or the working tree.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const clean = await GitTasks.mergesCleanly((s) =>
 *   s.branches("HEAD", "origin/main")
 * );
 * ```
 *
 * This is how a build answers "would this merge conflict?" without a checkout:
 * `merge` would have to alter the working tree and then be undone, which is
 * both slow and destructive if anything else is running.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { yesNoFromStatus } from "./status_answer.ts";

/** Settings for `git merge-tree`. */
export class GitMergeTreeSettings extends GitSettings {
  #writeTree = false;
  #messages = false;
  #nameOnly = false;
  #nul = false;
  #allowUnrelated = false;
  #mergeBase?: string;
  #branches: string[] = [];

  /**
   * Do a real merge and write the resulting tree (`--write-tree`), rather than
   * the trivial three-way form. This is the default in git 2.38 and later.
   */
  writeTree(): this {
    this.#writeTree = true;
    return this;
  }

  /** Also print the informational and conflict messages (`--messages`). */
  messages(): this {
    this.#messages = true;
    return this;
  }

  /** List conflicted filenames without modes or object names (`--name-only`). */
  nameOnly(): this {
    this.#nameOnly = true;
    return this;
  }

  /** Separate paths with NUL rather than newline (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** Permit merging histories with no common ancestor (`--allow-unrelated-histories`). */
  allowUnrelatedHistories(): this {
    this.#allowUnrelated = true;
    return this;
  }

  /** Use this commit as the merge base (`--merge-base=<commit>`). */
  mergeBase(commit: string): this {
    this.#mergeBase = commit;
    return this;
  }

  /** The two branches to merge (positional). */
  branches(...values: string[]): this {
    this.#branches.push(...values);
    return this;
  }

  /** Assemble the `git merge-tree` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#branches.length < 2) {
      throw new Error(
        "GitTasks.mergeTree: git merge-tree merges two commits — add " +
          `.branches(ours, theirs); ${this.#branches.length} was given.`,
      );
    }
    const argv = ["merge-tree"];
    if (this.#writeTree) argv.push("--write-tree");
    if (this.#messages) argv.push("--messages");
    if (this.#nameOnly) argv.push("--name-only");
    if (this.#nul) argv.push("-z");
    if (this.#allowUnrelated) argv.push("--allow-unrelated-histories");
    if (this.#mergeBase !== undefined) {
      argv.push(`--merge-base=${this.#mergeBase}`);
    }
    argv.push(...this.#branches);
    return argv;
  }
}

/**
 * Run `git merge-tree` and report whether the merge is conflict-free. Backs
 * {@link "./git.ts".GitTasks.mergesCleanly}.
 *
 * The exit status alone is not enough here, and assuming it is would be a real
 * bug. `0` is a clean merge, but `1` covers two different things: a genuine
 * conflict, *and* git being unable to merge at all — an unknown revision exits
 * `1` too, not the `128` the other interrogation commands use. Reading `1` as
 * "conflicted" would turn a mistyped branch name into a confident wrong answer.
 *
 * What separates them is structural rather than a message to match on: a real
 * conflict still produces a merge, so git writes the resulting tree's object
 * name to stdout and reports the conflicting paths; a revision it cannot
 * resolve produces nothing on stdout and explains itself on stderr. Both were
 * confirmed against git 2.43.0. So an empty stdout with a non-zero status is
 * raised, and only a conflict git actually performed is reported as `false`.
 */
export async function readMergesCleanly(
  configure?: Configure<GitMergeTreeSettings>,
): Promise<boolean> {
  const settings = new GitMergeTreeSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.quiet().noThrow().run();
  return yesNoFromStatus(output, {
    task: "mergesCleanly",
    command: "git merge-tree",
    noRequiresOutput: true,
  });
}
