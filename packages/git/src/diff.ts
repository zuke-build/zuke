// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git diff` — what changed, either printed or parsed into paths.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.diff((s) => s.staged().stat());
 * const changed = await GitTasks.diffNames((s) => s.commits("origin/main"));
 * ```
 *
 * {@link "./git.ts".GitTasks.diffNames} is the one a build usually wants: the
 * changed paths as values, so a target can decide what to rebuild without
 * scraping stdout. It pins `--name-only -z`, whose NUL-delimited output is the
 * only form a path with a space or a newline in it cannot corrupt.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { splitNul } from "./nul.ts";

/** Settings for `git diff`. */
export class GitDiffSettings extends GitSettings {
  #commits: string[] = [];
  #paths: string[] = [];
  #staged = false;
  #nameOnly = false;
  #nameStatus = false;
  #stat = false;
  #shortstat = false;
  #unified?: number;
  #ignoreAllSpace = false;
  #exitCode = false;
  #diffFilter?: string;
  #nul = false;

  /**
   * The commits to compare (positional); repeatable. One rev diffs the working
   * tree against it; two diff them against each other.
   */
  commits(...revs: string[]): this {
    this.#commits.push(...revs);
    return this;
  }

  /**
   * Compare the two ends of a range — `from...to` with three dots, which diffs
   * `to` against the point the two branches last shared. That is the diff a
   * pull request shows, and the one a review or an "affected" check wants,
   * since it excludes whatever landed on the base branch meanwhile.
   */
  mergeBase(from: string, to = "HEAD"): this {
    this.#commits.push(`${from}...${to}`);
    return this;
  }

  /** Limit the diff to these pathspecs (positional, after `--`); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Diff the index against `HEAD` rather than the working tree (`--staged`). */
  staged(): this {
    this.#staged = true;
    return this;
  }

  /** List the changed paths instead of the patch (`--name-only`). */
  nameOnly(): this {
    this.#nameOnly = true;
    return this;
  }

  /** List the changed paths with their status letters (`--name-status`). */
  nameStatus(): this {
    this.#nameStatus = true;
    return this;
  }

  /** Summarise the changes per file (`--stat`). */
  stat(): this {
    this.#stat = true;
    return this;
  }

  /** One summary line for the whole diff (`--shortstat`). */
  shortstat(): this {
    this.#shortstat = true;
    return this;
  }

  /** Lines of context around each hunk (`--unified=<n>`). */
  unified(lines: number): this {
    this.#unified = lines;
    return this;
  }

  /** Ignore whitespace entirely when comparing (`--ignore-all-space`). */
  ignoreAllSpace(): this {
    this.#ignoreAllSpace = true;
    return this;
  }

  /**
   * Report differences through the exit code (`--exit-code`): 1 when there are
   * any, 0 when there are none. Pair it with `.noThrow()` to branch on
   * `output.code` instead of catching.
   */
  exitCode(): this {
    this.#exitCode = true;
    return this;
  }

  /**
   * Keep only files whose change matches these status letters
   * (`--diff-filter=<letters>`), e.g. `ACM` for added, copied, and modified —
   * how a lint target skips paths the diff only deleted.
   */
  diffFilter(letters: string): this {
    this.#diffFilter = letters;
    return this;
  }

  /** Terminate output records with a NUL rather than a newline (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** Assemble the `git diff` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["diff"];
    if (this.#staged) argv.push("--staged");
    if (this.#stat) argv.push("--stat");
    if (this.#shortstat) argv.push("--shortstat");
    if (this.#nameStatus) argv.push("--name-status");
    // Last of the output-format flags, because git applies the one it sees
    // last: a caller who set two gets `--name-only`, and so does `diffNames`,
    // which pins it and would otherwise parse a `--stat` summary as paths.
    if (this.#nameOnly) argv.push("--name-only");
    if (this.#unified !== undefined) argv.push(`--unified=${this.#unified}`);
    if (this.#ignoreAllSpace) argv.push("--ignore-all-space");
    if (this.#exitCode) argv.push("--exit-code");
    if (this.#diffFilter !== undefined) {
      argv.push(`--diff-filter=${this.#diffFilter}`);
    }
    if (this.#nul) argv.push("-z");
    argv.push(...this.#commits);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/**
 * Run `git diff --name-only -z` and split it into paths. Backs
 * {@link "./git.ts".GitTasks.diffNames}.
 */
export async function readDiffNames(
  configure?: Configure<GitDiffSettings>,
): Promise<string[]> {
  const settings = new GitDiffSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.nameOnly().nulTerminated().run();
  return splitNul(output.stdout);
}
