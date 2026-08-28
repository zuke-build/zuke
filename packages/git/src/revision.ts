// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git rev-parse` and `git describe` — turning a name into the thing it means:
 * a commit SHA, the repository's root, or the nearest tag.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const sha = await GitTasks.revision((s) => s.short().rev("HEAD"));
 * await GitTasks.describe((s) => s.tags().abbrev(0));
 * ```
 *
 * {@link "./git.ts".GitTasks.revision} is the value-returning form — a trimmed
 * string, since that is what a version stamp or a cache key wants.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git rev-parse`. */
export class GitRevParseSettings extends GitSettings {
  #revs: string[] = [];
  #short?: number | true;
  #abbrevRef = false;
  #verify = false;
  #gitDir = false;
  #showToplevel = false;
  #showPrefix = false;
  #isInsideWorkTree = false;

  /** The revisions or arguments to resolve (positional); repeatable. */
  rev(...values: string[]): this {
    this.#revs.push(...values);
    return this;
  }

  /**
   * Abbreviate the SHA (`--short`, or `--short=<n>` with a length). git picks
   * a length long enough to stay unambiguous when none is given.
   */
  short(length?: number): this {
    this.#short = length ?? true;
    return this;
  }

  /** Print the ref's short name (`--abbrev-ref`), e.g. `main` for `HEAD`. */
  abbrevRef(): this {
    this.#abbrevRef = true;
    return this;
  }

  /** Fail rather than echo the argument when it names no object (`--verify`). */
  verify(): this {
    this.#verify = true;
    return this;
  }

  /** Print the path of the `.git` directory (`--git-dir`). */
  gitDir(): this {
    this.#gitDir = true;
    return this;
  }

  /** Print the absolute path of the working tree's root (`--show-toplevel`). */
  showToplevel(): this {
    this.#showToplevel = true;
    return this;
  }

  /** Print the current directory's path relative to that root (`--show-prefix`). */
  showPrefix(): this {
    this.#showPrefix = true;
    return this;
  }

  /** Print whether this is inside a working tree (`--is-inside-work-tree`). */
  isInsideWorkTree(): this {
    this.#isInsideWorkTree = true;
    return this;
  }

  /** Assemble the `git rev-parse` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["rev-parse"];
    if (this.#verify) argv.push("--verify");
    if (this.#short === true) argv.push("--short");
    else if (this.#short !== undefined) argv.push(`--short=${this.#short}`);
    if (this.#abbrevRef) argv.push("--abbrev-ref");
    if (this.#gitDir) argv.push("--git-dir");
    if (this.#showToplevel) argv.push("--show-toplevel");
    if (this.#showPrefix) argv.push("--show-prefix");
    if (this.#isInsideWorkTree) argv.push("--is-inside-work-tree");
    argv.push(...this.#revs);
    return argv;
  }
}

/** Settings for `git describe`. */
export class GitDescribeSettings extends GitSettings {
  #commitish?: string;
  #tags = false;
  #all = false;
  #always = false;
  #exactMatch = false;
  #abbrev?: number;
  #dirty?: string | true;
  #matches: string[] = [];

  /** The commit to describe (positional); defaults to `HEAD`. */
  commitish(rev: string): this {
    this.#commitish = rev;
    return this;
  }

  /** Consider lightweight tags too, not only annotated ones (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Consider every ref, not only tags (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Fall back to an abbreviated SHA when no tag matches (`--always`). */
  always(): this {
    this.#always = true;
    return this;
  }

  /** Fail unless the commit is exactly at a tag (`--exact-match`). */
  exactMatch(): this {
    this.#exactMatch = true;
    return this;
  }

  /**
   * How many SHA characters to append (`--abbrev=<n>`). `0` suppresses the
   * suffix entirely, which is how a build reads the nearest tag's bare name.
   */
  abbrev(length: number): this {
    this.#abbrev = length;
    return this;
  }

  /** Append a marker when the working tree is dirty (`--dirty[=<suffix>]`). */
  dirty(suffix?: string): this {
    this.#dirty = suffix ?? true;
    return this;
  }

  /** Only consider tags matching this glob (`--match <pattern>`); repeatable. */
  match(...patterns: string[]): this {
    this.#matches.push(...patterns);
    return this;
  }

  /** Assemble the `git describe` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#dirty !== undefined && this.#commitish !== undefined) {
      throw new Error(
        "GitTasks.describe: --dirty describes the working tree, so git " +
          "refuses a commit alongside it — drop .dirty() or .commitish(...).",
      );
    }
    const argv = ["describe"];
    if (this.#tags) argv.push("--tags");
    if (this.#all) argv.push("--all");
    if (this.#always) argv.push("--always");
    if (this.#exactMatch) argv.push("--exact-match");
    if (this.#abbrev !== undefined) argv.push(`--abbrev=${this.#abbrev}`);
    if (this.#dirty === true) argv.push("--dirty");
    else if (this.#dirty !== undefined) argv.push(`--dirty=${this.#dirty}`);
    for (const pattern of this.#matches) argv.push("--match", pattern);
    if (this.#commitish !== undefined) argv.push(this.#commitish);
    return argv;
  }
}

/**
 * Run `git rev-parse` and hand back its trimmed output. Backs
 * {@link "./git.ts".GitTasks.revision}.
 */
export async function readRevision(
  configure?: Configure<GitRevParseSettings>,
): Promise<string> {
  const settings = new GitRevParseSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.run();
  return output.stdout.trim();
}
