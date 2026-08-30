// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git grep` — searching tracked content, at the working tree or at any
 * revision.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.grep((s) => s.pattern("TODO").lineNumber().paths("packages/"));
 * ```
 *
 * What it offers over a general-purpose search is the scope: it looks at what
 * git tracks, so ignored build output and vendored trees are not in the
 * results, and it can search a revision without checking it out.
 *
 * @module
 */

import { GitSettings } from "./settings.ts";

/** Settings for `git grep`. */
export class GitGrepSettings extends GitSettings {
  #patterns: string[] = [];
  #ignoreCase = false;
  #wordRegexp = false;
  #invert = false;
  #lineNumber = false;
  #namesOnly = false;
  #countMatches = false;
  #extendedRegexp = false;
  #fixedStrings = false;
  #cached = false;
  #untracked = false;
  #nul = false;
  #maxDepth?: number;
  #context?: number;
  #revisions: string[] = [];
  #paths: string[] = [];

  /** A pattern to search for (`-e <pattern>`); repeatable. */
  pattern(...values: string[]): this {
    this.#patterns.push(...values);
    return this;
  }

  /** Match case-insensitively (`-i`). */
  ignoreCase(): this {
    this.#ignoreCase = true;
    return this;
  }

  /** Match only at word boundaries (`-w`). */
  wordRegexp(): this {
    this.#wordRegexp = true;
    return this;
  }

  /** Report the lines that do *not* match (`-v`). */
  invert(): this {
    this.#invert = true;
    return this;
  }

  /** Prefix each match with its line number (`-n`). */
  lineNumber(): this {
    this.#lineNumber = true;
    return this;
  }

  /** Report only the names of matching files (`-l`). */
  namesOnly(): this {
    this.#namesOnly = true;
    return this;
  }

  /** Report only how many lines matched per file (`-c`). */
  countMatches(): this {
    this.#countMatches = true;
    return this;
  }

  /** Read the pattern as a POSIX extended regexp (`-E`). */
  extendedRegexp(): this {
    this.#extendedRegexp = true;
    return this;
  }

  /** Read the pattern as a literal string (`-F`). */
  fixedStrings(): this {
    this.#fixedStrings = true;
    return this;
  }

  /** Search the index rather than the working tree (`--cached`). */
  cached(): this {
    this.#cached = true;
    return this;
  }

  /** Search untracked files as well as tracked ones (`--untracked`). */
  untracked(): this {
    this.#untracked = true;
    return this;
  }

  /** Terminate output records with NUL (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** Descend at most this many directories (`--max-depth=<n>`). */
  maxDepth(value: number): this {
    this.#maxDepth = value;
    return this;
  }

  /** Show this many lines of context around each match (`-C <n>`). */
  context(lines: number): this {
    this.#context = lines;
    return this;
  }

  /** Search these revisions rather than the working tree (positional). */
  revisions(...values: string[]): this {
    this.#revisions.push(...values);
    return this;
  }

  /** Limit the search to these paths (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git grep` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#patterns.length === 0) {
      throw new Error(
        "GitTasks.grep: no pattern given — add .pattern('TODO'), since git " +
          "grep needs something to search for.",
      );
    }
    // git accepts both and lets the last one on the command line win, so the
    // pattern would be read literally or as a regexp depending on the order the
    // settings lambda happened to call them in. Refuse rather than let that
    // decide whether `Zu.e` matches.
    if (this.#extendedRegexp && this.#fixedStrings) {
      throw new Error(
        "GitTasks.grep: .extendedRegexp() and .fixedStrings() read the same " +
          "pattern two different ways, and git silently lets the last flag " +
          "win — pick one.",
      );
    }
    // git accepts both and prints names alone: the counts -c asked for are
    // dropped without a word, which reads as "every file matched once".
    if (this.#namesOnly && this.#countMatches) {
      throw new Error(
        "GitTasks.grep: .namesOnly() and .countMatches() each reduce the " +
          "output to a different shape, and git silently drops the counts — " +
          "pick one.",
      );
    }
    if (this.#cached && this.#untracked) {
      throw new Error(
        "GitTasks.grep: .cached() searches the index and .untracked() " +
          "searches files the index does not hold — git rejects them " +
          "together. Keep one.",
      );
    }
    const argv = ["grep"];
    if (this.#ignoreCase) argv.push("-i");
    if (this.#wordRegexp) argv.push("-w");
    if (this.#invert) argv.push("-v");
    if (this.#lineNumber) argv.push("-n");
    if (this.#namesOnly) argv.push("-l");
    if (this.#countMatches) argv.push("-c");
    if (this.#extendedRegexp) argv.push("-E");
    if (this.#fixedStrings) argv.push("-F");
    if (this.#cached) argv.push("--cached");
    if (this.#untracked) argv.push("--untracked");
    if (this.#nul) argv.push("-z");
    if (this.#maxDepth !== undefined) {
      argv.push(`--max-depth=${this.#maxDepth}`);
    }
    if (this.#context !== undefined) argv.push("-C", String(this.#context));
    // `-e` before every pattern so one beginning with `-` is still a pattern.
    for (const pattern of this.#patterns) argv.push("-e", pattern);
    argv.push(...this.#revisions);
    // `--` so a pathspec is never read as a revision.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
