// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git rev-list` — walking history as a list of commits, and counting it.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const build = await GitTasks.commitCount((s) => s.commits("HEAD"));
 * const ahead = await GitTasks.commitCount((s) => s.commits("origin/main..HEAD"));
 * ```
 *
 * {@link "./git.ts".GitTasks.commitCount} is the reader: `--count` makes git
 * do the counting, so the build gets a number instead of a line tally over
 * output it had to capture in full.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git rev-list`. */
export class GitRevListSettings extends GitSettings {
  #count = false;
  #maxCount?: number;
  #skip?: number;
  #all = false;
  #branches = false;
  #tags = false;
  #remotes = false;
  #noMerges = false;
  #merges = false;
  #firstParent = false;
  #reverse = false;
  #topoOrder = false;
  #dateOrder = false;
  #since?: string;
  #until?: string;
  #author?: string;
  #commits: string[] = [];
  #paths: string[] = [];

  /**
   * Print how many commits the walk found rather than listing them
   * (`--count`). Prefer {@link "./git.ts".GitTasks.commitCount}, which reads
   * that number back.
   */
  count(): this {
    this.#count = true;
    return this;
  }

  /** Stop after this many commits (`--max-count=<n>`). */
  maxCount(value: number): this {
    this.#maxCount = value;
    return this;
  }

  /** Skip this many commits before printing (`--skip=<n>`). */
  skip(value: number): this {
    this.#skip = value;
    return this;
  }

  /** Walk every ref in `refs/` (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Walk every branch (`--branches`). */
  branches(): this {
    this.#branches = true;
    return this;
  }

  /** Walk every tag (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Walk every remote-tracking branch (`--remotes`). */
  remotes(): this {
    this.#remotes = true;
    return this;
  }

  /** Omit merge commits (`--no-merges`). */
  noMerges(): this {
    this.#noMerges = true;
    return this;
  }

  /** Keep only merge commits (`--merges`). */
  merges(): this {
    this.#merges = true;
    return this;
  }

  /** Follow only the first parent of each merge (`--first-parent`). */
  firstParent(): this {
    this.#firstParent = true;
    return this;
  }

  /** Emit the commits oldest first (`--reverse`). */
  reverse(): this {
    this.#reverse = true;
    return this;
  }

  /** Order by topology rather than date (`--topo-order`). */
  topoOrder(): this {
    this.#topoOrder = true;
    return this;
  }

  /** Order by commit date (`--date-order`). */
  dateOrder(): this {
    this.#dateOrder = true;
    return this;
  }

  /** Only commits after this date (`--since=<date>`). */
  since(value: string): this {
    this.#since = value;
    return this;
  }

  /** Only commits before this date (`--until=<date>`). */
  until(value: string): this {
    this.#until = value;
    return this;
  }

  /** Only commits whose author matches (`--author=<pattern>`). */
  author(pattern: string): this {
    this.#author = pattern;
    return this;
  }

  /**
   * The commits or ranges to walk (positional), e.g. `"HEAD"` or
   * `"origin/main..HEAD"`; repeatable.
   */
  commits(...values: string[]): this {
    this.#commits.push(...values);
    return this;
  }

  /** Limit the walk to commits touching these paths (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git rev-list` argv. */
  protected override subcommandArgs(): string[] {
    const hasRefSelector = this.#all || this.#branches || this.#tags ||
      this.#remotes;
    if (this.#commits.length === 0 && !hasRefSelector) {
      throw new Error(
        "GitTasks.revList: no starting point — add .commits('HEAD'), or a " +
          "selector like .all()/.branches()/.tags(), since git rev-list needs " +
          "somewhere to begin the walk.",
      );
    }
    // git accepts both together and reports zero commits, since none is both a
    // merge and not one. That zero is indistinguishable from a real empty
    // result, so refuse the contradiction rather than hand back a plausible
    // wrong answer.
    if (this.#noMerges && this.#merges) {
      throw new Error(
        "GitTasks.revList: .merges() and .noMerges() are opposites — git " +
          "accepts both and always reports zero commits, which looks like a " +
          "real answer. Keep one.",
      );
    }
    const argv = ["rev-list"];
    if (this.#count) argv.push("--count");
    if (this.#maxCount !== undefined) {
      argv.push(`--max-count=${this.#maxCount}`);
    }
    if (this.#skip !== undefined) argv.push(`--skip=${this.#skip}`);
    if (this.#all) argv.push("--all");
    if (this.#branches) argv.push("--branches");
    if (this.#tags) argv.push("--tags");
    if (this.#remotes) argv.push("--remotes");
    if (this.#noMerges) argv.push("--no-merges");
    if (this.#merges) argv.push("--merges");
    if (this.#firstParent) argv.push("--first-parent");
    if (this.#reverse) argv.push("--reverse");
    if (this.#topoOrder) argv.push("--topo-order");
    if (this.#dateOrder) argv.push("--date-order");
    if (this.#since !== undefined) argv.push(`--since=${this.#since}`);
    if (this.#until !== undefined) argv.push(`--until=${this.#until}`);
    if (this.#author !== undefined) argv.push(`--author=${this.#author}`);
    argv.push(...this.#commits);
    // `--` so a pathspec beginning with `-`, or one that looks like a revision,
    // is never read as anything but a path.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/**
 * Run `git rev-list --count` and return the number it printed. Backs
 * {@link "./git.ts".GitTasks.commitCount}.
 */
export async function readCommitCount(
  configure?: Configure<GitRevListSettings>,
): Promise<number> {
  const settings = new GitRevListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.count().quiet().run();
  const text = output.stdout.trim();
  // `--count` prints one decimal integer and nothing else; anything else means
  // the output is not the count this reader promises to return.
  if (!/^\d+$/.test(text)) {
    throw new Error(
      `GitTasks.commitCount: git printed ${
        text === "" ? "nothing" : JSON.stringify(text)
      }, which is not a commit count.`,
    );
  }
  return Number(text);
}
