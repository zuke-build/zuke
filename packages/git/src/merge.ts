// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git merge` and `git rebase` — the two ways one line of history joins
 * another.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.merge((s) => s.refs("origin/main").noFf());
 * await GitTasks.rebase((s) => s.upstream("origin/main").autostash());
 * await GitTasks.rebase((s) => s.abort()); // unwind one left in progress
 * ```
 *
 * Both extend {@link "./sequencer.ts".GitSequencerSettings}, so a conflict is
 * resolved, unwound, or dropped with the same `.continue()`, `.abort()`,
 * `.skip()`, `.quit()` on either.
 *
 * @module
 */

import { GitSequencerSettings } from "./sequencer.ts";

/** Settings for `git merge`. */
export class GitMergeSettings extends GitSequencerSettings {
  #refs: string[] = [];
  #message?: string;
  #noFf = false;
  #ffOnly = false;
  #squash = false;
  #noCommit = false;
  #strategy?: string;
  #strategyOptions: string[] = [];
  #allowUnrelatedHistories = false;

  /** The commits to merge into the current branch (positional); repeatable. */
  refs(...values: string[]): this {
    this.#refs.push(...values);
    return this;
  }

  /** The merge commit's message (`-m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Always create a merge commit (`--no-ff`), even when a fast-forward would do. */
  noFf(): this {
    this.#noFf = true;
    return this;
  }

  /** Refuse anything but a fast-forward (`--ff-only`). */
  ffOnly(): this {
    this.#ffOnly = true;
    return this;
  }

  /** Stage the merged result without recording a merge (`--squash`). */
  squash(): this {
    this.#squash = true;
    return this;
  }

  /** Merge but leave the commit to the caller (`--no-commit`). */
  noCommit(): this {
    this.#noCommit = true;
    return this;
  }

  /** The merge strategy (`--strategy=<name>`), e.g. `ours`. */
  strategy(name: string): this {
    this.#strategy = name;
    return this;
  }

  /**
   * An option for the strategy (`--strategy-option=<option>`), e.g.
   * `theirs` to resolve conflicting hunks in favour of the merged branch;
   * repeatable.
   */
  strategyOption(...options: string[]): this {
    this.#strategyOptions.push(...options);
    return this;
  }

  /** Merge histories that share no commit (`--allow-unrelated-histories`). */
  allowUnrelatedHistories(): this {
    this.#allowUnrelatedHistories = true;
    return this;
  }

  /** The flags and refs `git merge` would run with, before any control flag. */
  #options(): string[] {
    const argv: string[] = [];
    if (this.#noFf) argv.push("--no-ff");
    if (this.#ffOnly) argv.push("--ff-only");
    if (this.#squash) argv.push("--squash");
    if (this.#noCommit) argv.push("--no-commit");
    if (this.#allowUnrelatedHistories) argv.push("--allow-unrelated-histories");
    if (this.#strategy !== undefined) argv.push(`--strategy=${this.#strategy}`);
    for (const option of this.#strategyOptions) {
      argv.push(`--strategy-option=${option}`);
    }
    if (this.#message !== undefined) argv.push("-m", this.#message);
    argv.push(...this.#refs);
    return argv;
  }

  /** Assemble the `git merge` argv. */
  protected override subcommandArgs(): string[] {
    if (this.controlling) {
      return this.controlArgs_("merge", "merge", this.#options());
    }
    if (this.#noFf && this.#ffOnly) {
      throw new Error(
        "GitTasks.merge: .noFf() always creates a merge commit and .ffOnly() " +
          "refuses to create one — pick one.",
      );
    }
    if (this.#refs.length === 0) {
      throw new Error(
        "GitTasks.merge: .refs(...) is required — it names what to merge in.",
      );
    }
    return ["merge", ...this.#options()];
  }
}

/** Settings for `git rebase`. */
export class GitRebaseSettings extends GitSequencerSettings {
  #upstream?: string;
  #branch?: string;
  #onto?: string;
  #autosquash = false;
  #autostash = false;
  #keepEmpty = false;
  #rebaseMerges = false;
  #strategy?: string;
  #strategyOptions: string[] = [];

  /** The commit the current branch is replayed onto (positional). */
  upstream(rev: string): this {
    this.#upstream = rev;
    return this;
  }

  /** Rebase this branch rather than the checked-out one (git's `<branch>`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Replay onto a different base than the upstream (`--onto <newbase>`). */
  onto(rev: string): this {
    this.#onto = rev;
    return this;
  }

  /** Fold `fixup!`/`squash!` commits into their targets (`--autosquash`). */
  autosquash(): this {
    this.#autosquash = true;
    return this;
  }

  /**
   * Stash local changes and restore them afterwards (`--autostash`), instead
   * of refusing to start on a dirty tree.
   */
  autostash(): this {
    this.#autostash = true;
    return this;
  }

  /** Keep commits that produce no changes (`--keep-empty`). */
  keepEmpty(): this {
    this.#keepEmpty = true;
    return this;
  }

  /** Recreate merge commits rather than flattening them (`--rebase-merges`). */
  rebaseMerges(): this {
    this.#rebaseMerges = true;
    return this;
  }

  /** The merge strategy used to replay each commit (`--strategy=<name>`). */
  strategy(name: string): this {
    this.#strategy = name;
    return this;
  }

  /** An option for that strategy (`--strategy-option=<option>`); repeatable. */
  strategyOption(...options: string[]): this {
    this.#strategyOptions.push(...options);
    return this;
  }

  /** Drop the current commit and carry on (`--skip`). */
  skip(): this {
    return this.sequencer_("skip");
  }

  /** The flags and revisions `git rebase` would run with, before any control flag. */
  #options(): string[] {
    const argv: string[] = [];
    if (this.#autosquash) argv.push("--autosquash");
    if (this.#autostash) argv.push("--autostash");
    if (this.#keepEmpty) argv.push("--keep-empty");
    if (this.#rebaseMerges) argv.push("--rebase-merges");
    if (this.#strategy !== undefined) argv.push(`--strategy=${this.#strategy}`);
    for (const option of this.#strategyOptions) {
      argv.push(`--strategy-option=${option}`);
    }
    if (this.#onto !== undefined) argv.push("--onto", this.#onto);
    if (this.#upstream !== undefined) argv.push(this.#upstream);
    if (this.#branch !== undefined) argv.push(this.#branch);
    return argv;
  }

  /** Assemble the `git rebase` argv. */
  protected override subcommandArgs(): string[] {
    if (this.controlling) {
      return this.controlArgs_("rebase", "rebase", this.#options());
    }
    if (this.#upstream === undefined && this.#onto === undefined) {
      throw new Error(
        "GitTasks.rebase: .upstream(...) is required — it names what to " +
          "replay the branch onto.",
      );
    }
    return ["rebase", ...this.#options()];
  }
}
