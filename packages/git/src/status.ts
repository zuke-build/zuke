// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git status` — the state of the working tree, either printed or parsed.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.status((s) => s.short().branch());
 * const changes = await GitTasks.statusEntries();
 * if (changes.length > 0) throw new Error("the working tree is dirty");
 * ```
 *
 * {@link "./git.ts".GitTasks.statusEntries} is the one that hands back values:
 * it runs the `--porcelain -z` form, whose NUL-delimited records are the only
 * ones a path containing a space, a quote, or a newline cannot corrupt.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { splitNul } from "./nul_records.ts";

/** Settings for `git status`. */
export class GitStatusSettings extends GitSettings {
  #short = false;
  #porcelain = false;
  #branch = false;
  #nul = false;
  #untrackedFiles?: string;
  #ignored = false;
  #paths: string[] = [];

  /** Short-format output (`-s`/`--short`). */
  short(): this {
    this.#short = true;
    return this;
  }

  /** Stable machine-readable output (`--porcelain`). */
  porcelain(): this {
    this.#porcelain = true;
    return this;
  }

  /** Show branch information (`-b`/`--branch`). */
  branch(): this {
    this.#branch = true;
    return this;
  }

  /**
   * Terminate each record with a NUL rather than a newline (`-z`), which also
   * turns on `--porcelain` and stops git quoting unusual paths.
   */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /**
   * How much of an untracked directory to report (`--untracked-files=<mode>`):
   * `no`, `normal` (the default — the directory), or `all` (every file in it).
   */
  untrackedFiles(mode: "no" | "normal" | "all"): this {
    this.#untrackedFiles = mode;
    return this;
  }

  /** Also report ignored files (`--ignored`). */
  ignored(): this {
    this.#ignored = true;
    return this;
  }

  /** Limit the report to these pathspecs (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git status` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["status"];
    if (this.#short) argv.push("--short");
    if (this.#porcelain) argv.push("--porcelain");
    if (this.#branch) argv.push("--branch");
    if (this.#nul) argv.push("-z");
    if (this.#untrackedFiles !== undefined) {
      argv.push(`--untracked-files=${this.#untrackedFiles}`);
    }
    if (this.#ignored) argv.push("--ignored");
    // `--` so a pathspec beginning with `-` is never read as a flag.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** One record of `git status --porcelain -z`: a path and how it changed. */
export interface GitStatusEntry {
  /**
   * The index (staged) status code — git's `X` column: `M` modified, `A`
   * added, `D` deleted, `R` renamed, `C` copied, `?` untracked, `!` ignored,
   * or a space when the index matches `HEAD`.
   */
  index: string;
  /**
   * The working-tree status code — git's `Y` column, with the same letters,
   * or a space when the working tree matches the index.
   */
  workingTree: string;
  /** The path, relative to the repository root; for a rename, the new one. */
  path: string;
  /** Where a renamed or copied entry came from; absent otherwise. */
  originalPath?: string;
}

/**
 * Parse `git status --porcelain -z` into entries. Each record is
 * `XY <path>`; a rename or copy is followed by a second record holding the
 * path it came from, which is why this cannot be a plain map over the fields.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseStatusEntries(stdout: string): GitStatusEntry[] {
  const fields = splitNul(stdout);
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    // A record shorter than `XY ` carries no path; a truncated read is the only
    // way to get one, and there is nothing to report about it.
    if (record === undefined || record.length < 4) continue;
    const index = record.slice(0, 1);
    const workingTree = record.slice(1, 2);
    const entry: GitStatusEntry = {
      index,
      workingTree,
      path: record.slice(3),
    };
    if (
      index === "R" || index === "C" || workingTree === "R" ||
      workingTree === "C"
    ) {
      const original = fields[i + 1];
      if (original !== undefined) {
        entry.originalPath = original;
        i++;
      }
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Run `git status --porcelain -z` and parse it. Backs
 * {@link "./git.ts".GitTasks.statusEntries}.
 */
export async function readStatusEntries(
  configure?: Configure<GitStatusSettings>,
): Promise<GitStatusEntry[]> {
  const settings = new GitStatusSettings();
  const configured = configure ? configure(settings) : settings;
  configured.porcelain().nulTerminated();
  // `--branch` prepends a `## <branch>...<upstream>` header record, which is
  // not an entry; refuse rather than reporting it as a change to a file named
  // after the branch.
  if (configured.argv().includes("--branch")) {
    throw new Error(
      "GitTasks.statusEntries: .branch() adds a header record that is not a " +
        "changed path — drop it, or use GitTasks.status to read that output.",
    );
  }
  const output = await configured.run();
  return parseStatusEntries(output.stdout);
}
