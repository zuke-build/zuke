// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git cherry-pick` and `git revert` — the two commands that replay an
 * existing commit onto the current branch, forwards and backwards.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.cherryPick((s) => s.commits(sha));
 * await GitTasks.revert((s) => s.commits(sha).noEdit());
 * await GitTasks.cherryPick((s) => s.abort()); // unwind a conflicted one
 * ```
 *
 * Both extend {@link "./sequencer.ts".GitSequencerSettings}: a conflict is
 * resolved with `.continue()`, dropped with `.skip()`, or unwound with
 * `.abort()`, exactly as on `merge` and `rebase`.
 *
 * @module
 */

import { GitSequencerSettings } from "./sequencer.ts";

/**
 * Shared base for `cherry-pick` and `revert`: the same commit list, the same
 * `--no-commit`/`--mainline`, and the same four control flags. Only the
 * subcommand's name and the extra flags differ, which is why they are one
 * implementation rather than two that drift.
 */
export abstract class GitReplaySettings extends GitSequencerSettings {
  #commits: string[] = [];
  #noCommit = false;
  #mainline?: number;
  #signoff = false;

  /** The commits to replay (positional, required); repeatable. */
  commits(...revs: string[]): this {
    this.#commits.push(...revs);
    return this;
  }

  /** Apply the change without committing it (`-n`/`--no-commit`). */
  noCommit(): this {
    this.#noCommit = true;
    return this;
  }

  /**
   * Which parent of a merge commit to treat as the mainline
   * (`-m <parent-number>`), counting from 1. Replaying a merge needs it: git
   * cannot otherwise tell which side of the merge the change is.
   */
  mainline(parent: number): this {
    this.#mainline = parent;
    return this;
  }

  /** Add a `Signed-off-by` trailer (`--signoff`). */
  signoff(): this {
    this.#signoff = true;
    return this;
  }

  /** Drop the current commit and carry on (`--skip`). */
  skip(): this {
    return this.sequencer_("skip");
  }

  /** The subcommand token, e.g. `"cherry-pick"`. */
  protected abstract replayCommand(): string;

  /** The `GitTasks` method's name, for the errors this base reports. */
  protected abstract taskName(): string;

  /** The flags this command adds beyond the shared ones. */
  protected abstract replayFlags(): string[];

  /** The flags and commits the command would run with, before any control flag. */
  #options(): string[] {
    const argv: string[] = [];
    if (this.#noCommit) argv.push("--no-commit");
    if (this.#signoff) argv.push("--signoff");
    if (this.#mainline !== undefined) {
      argv.push("--mainline", String(this.#mainline));
    }
    argv.push(...this.replayFlags());
    argv.push(...this.#commits);
    return argv;
  }

  /** Assemble the `cherry-pick`/`revert` argv. */
  protected override subcommandArgs(): string[] {
    const command = this.replayCommand();
    if (this.controlling) {
      return this.controlArgs_(this.taskName(), command, this.#options());
    }
    if (this.#commits.length === 0) {
      throw new Error(
        `GitTasks.${this.taskName()}: .commits(...) is required — it names ` +
          `what to replay.`,
      );
    }
    return [command, ...this.#options()];
  }
}

/** Settings for `git cherry-pick`. */
export class GitCherryPickSettings extends GitReplaySettings {
  #allowEmpty = false;
  #ff = false;

  /** Keep a commit that produces no changes (`--allow-empty`). */
  allowEmpty(): this {
    this.#allowEmpty = true;
    return this;
  }

  /** Fast-forward instead of rewriting when the parent matches `HEAD` (`--ff`). */
  ff(): this {
    this.#ff = true;
    return this;
  }

  /** The `cherry-pick` subcommand token. */
  protected override replayCommand(): string {
    return "cherry-pick";
  }

  /** The `GitTasks` method that runs it. */
  protected override taskName(): string {
    return "cherryPick";
  }

  /** `cherry-pick`'s own flags. */
  protected override replayFlags(): string[] {
    const argv: string[] = [];
    if (this.#allowEmpty) argv.push("--allow-empty");
    if (this.#ff) argv.push("--ff");
    return argv;
  }
}

/** Settings for `git revert`. */
export class GitRevertSettings extends GitReplaySettings {
  #noEdit = false;

  /** Take the generated message without opening an editor (`--no-edit`). */
  noEdit(): this {
    this.#noEdit = true;
    return this;
  }

  /** The `revert` subcommand token. */
  protected override replayCommand(): string {
    return "revert";
  }

  /** The `GitTasks` method that runs it. */
  protected override taskName(): string {
    return "revert";
  }

  /** `revert`'s own flags. */
  protected override replayFlags(): string[] {
    return this.#noEdit ? ["--no-edit"] : [];
  }
}
