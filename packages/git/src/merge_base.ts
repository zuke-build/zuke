// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git merge-base` — the common ancestor of two commits, and the containment
 * question a build asks about a branch.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const base = await GitTasks.mergeBase((s) => s.commits("HEAD", "origin/main"));
 * if (await GitTasks.isAncestor((s) => s.commits("v1.0.0", "HEAD"))) {
 *   // the release tag is contained in this branch
 * }
 * ```
 *
 * {@link "./git.ts".GitTasks.isAncestor} is the reader whose answer is an exit
 * status rather than output — see {@link readIsAncestor} for why that needs
 * more care than reading `code === 0`.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { yesNoFromStatus } from "./status_answer.ts";

/** Settings for `git merge-base`. */
export class GitMergeBaseSettings extends GitSettings {
  #all = false;
  #octopus = false;
  #independent = false;
  #isAncestor = false;
  #forkPoint = false;
  #commits: string[] = [];

  /** Output every common ancestor rather than one (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Find the ancestors for a single n-way merge (`--octopus`). */
  octopus(): this {
    this.#octopus = true;
    return this;
  }

  /** List the revisions not reachable from any other (`--independent`). */
  independent(): this {
    this.#independent = true;
    return this;
  }

  /**
   * Ask whether the first commit is an ancestor of the second
   * (`--is-ancestor`), which git answers by exit status and prints nothing.
   * Prefer {@link "./git.ts".GitTasks.isAncestor}, which reads that status
   * back as a boolean.
   */
  isAncestor(): this {
    this.#isAncestor = true;
    return this;
  }

  /** Find where a commit forked from a ref's reflog (`--fork-point`). */
  forkPoint(): this {
    this.#forkPoint = true;
    return this;
  }

  /** The commits to consider (positional); repeatable. */
  commits(...values: string[]): this {
    this.#commits.push(...values);
    return this;
  }

  /** Assemble the `git merge-base` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#commits.length === 0) {
      throw new Error(
        "GitTasks.mergeBase: no commits given — add .commits(a, b), since " +
          "git needs the revisions whose ancestor it should find.",
      );
    }
    // The modes are alternative usages rather than combinable flags: git's own
    // synopsis lists each on its own line, and it refuses more than one.
    const modes: Array<[string, boolean]> = [
      [".octopus()", this.#octopus],
      [".independent()", this.#independent],
      [".isAncestor()", this.#isAncestor],
      [".forkPoint()", this.#forkPoint],
    ];
    const chosen = modes.filter(([, on]) => on).map(([name]) => name);
    if (chosen.length > 1) {
      throw new Error(
        `GitTasks.mergeBase: ${
          chosen.join(" and ")
        } are separate usages of git merge-base — pick one.`,
      );
    }
    // `--all` asks for every ancestor, which two of the modes have no room
    // for: git rejects both pairings outright ("options '--is-ancestor' and
    // '--all' cannot be used together"), while `--octopus` and `--fork-point`
    // accept it.
    if (this.#all && (this.#isAncestor || this.#independent)) {
      const mode = this.#isAncestor ? ".isAncestor()" : ".independent()";
      throw new Error(
        `GitTasks.mergeBase: .all() cannot be combined with ${mode} — that ` +
          "mode answers with one result, so there is no set to widen. Drop " +
          "one of the two.",
      );
    }
    if (this.#isAncestor && this.#commits.length !== 2) {
      throw new Error(
        "GitTasks.isAncestor: --is-ancestor takes exactly two commits, but " +
          `${this.#commits.length} were given — pass .commits(maybeAncestor, ` +
          "descendant).",
      );
    }
    const argv = ["merge-base"];
    if (this.#all) argv.push("--all");
    if (this.#octopus) argv.push("--octopus");
    if (this.#independent) argv.push("--independent");
    if (this.#isAncestor) argv.push("--is-ancestor");
    if (this.#forkPoint) argv.push("--fork-point");
    argv.push(...this.#commits);
    return argv;
  }
}

/**
 * Run `git merge-base` and return the common ancestor it printed. Backs
 * {@link "./git.ts".GitTasks.mergeBase}.
 */
export async function readMergeBase(
  configure?: Configure<GitMergeBaseSettings>,
): Promise<string> {
  const settings = new GitMergeBaseSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.quiet().run();
  const first = output.stdout.trim().split("\n")[0] ?? "";
  if (first === "") {
    throw new Error(
      "GitTasks.mergeBase: git printed no commit — the revisions given share " +
        "no common ancestor, which is the case for unrelated histories.",
    );
  }
  return first;
}

/**
 * Run `git merge-base --is-ancestor` and read its exit status as a boolean.
 * Backs {@link "./git.ts".GitTasks.isAncestor}.
 *
 * The status carries three outcomes, not two: `0` is yes, `1` is no, and
 * anything else is git failing — a revision that does not name an object exits
 * `128`. See `yesNoFromStatus`, which is where that distinction is kept for
 * every command that answers this way. A missing git still throws, because
 * tool resolution raises before any process runs.
 */
export async function readIsAncestor(
  configure?: Configure<GitMergeBaseSettings>,
): Promise<boolean> {
  const settings = new GitMergeBaseSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.isAncestor().quiet().noThrow().run();
  return yesNoFromStatus(output, {
    task: "isAncestor",
    command: "git merge-base --is-ancestor",
  });
}
