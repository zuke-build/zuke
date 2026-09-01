// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git ls-files` — what the index and the working tree hold, which is how a
 * build asks git for its file list instead of walking the directory and
 * re-implementing `.gitignore`.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.lsFiles((s) => s.cached().paths("packages"));
 * const untracked = await GitTasks.lsFileNames((s) =>
 *   s.others().excludeStandard()
 * );
 * ```
 *
 * {@link "./git.ts".GitTasks.lsFileNames} hands the paths back as values, from
 * the `-z` form whose NUL-delimited records survive a path containing a space
 * or a newline.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { splitNul } from "./nul_records.ts";

/** Settings for `git ls-files`. */
export class GitLsFilesSettings extends GitSettings {
  #paths: string[] = [];
  #cached = false;
  #modified = false;
  #deleted = false;
  #others = false;
  #ignored = false;
  #stage = false;
  #excludeStandard = false;
  #directory = false;
  #nul = false;
  #errorUnmatch = false;

  /** Limit the listing to these pathspecs (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** List files in the index (`--cached`), git's default. */
  cached(): this {
    this.#cached = true;
    return this;
  }

  /** List files modified in the working tree (`--modified`). */
  modified(): this {
    this.#modified = true;
    return this;
  }

  /** List files deleted from the working tree (`--deleted`). */
  deleted(): this {
    this.#deleted = true;
    return this;
  }

  /**
   * List untracked files (`--others`). Pair it with {@link excludeStandard},
   * or the listing includes everything `.gitignore` covers.
   */
  others(): this {
    this.#others = true;
    return this;
  }

  /** List ignored files (`--ignored`); only meaningful with {@link others}. */
  ignored(): this {
    this.#ignored = true;
    return this;
  }

  /** Show the mode, object name, and stage of each entry (`--stage`). */
  stage(): this {
    this.#stage = true;
    return this;
  }

  /** Apply the standard ignore rules (`--exclude-standard`). */
  excludeStandard(): this {
    this.#excludeStandard = true;
    return this;
  }

  /** Report an untracked directory once rather than every file in it (`--directory`). */
  directory(): this {
    this.#directory = true;
    return this;
  }

  /**
   * Exit non-zero when a pathspec matches nothing (`--error-unmatch`), which
   * is how a build asserts that a path is tracked rather than reading the
   * listing to see whether it came back empty.
   *
   * git only applies it to the paths it was given, so it needs
   * {@link paths} — the flag on its own describes a whole-tree listing, which
   * always matches something.
   */
  errorUnmatch(): this {
    this.#errorUnmatch = true;
    return this;
  }

  /** Terminate each entry with a NUL rather than a newline (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** Assemble the `git ls-files` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#errorUnmatch && this.#paths.length === 0) {
      throw new Error(
        "GitTasks.lsFiles: .errorUnmatch() makes git fail when a pathspec " +
          "matches nothing, so it needs the pathspecs — add .paths(...). " +
          "Without them the listing covers the whole tree and always matches.",
      );
    }
    if (this.#ignored && !this.#others) {
      throw new Error(
        "GitTasks.lsFiles: .ignored() filters an untracked listing — add " +
          ".others(), which is what git requires alongside it.",
      );
    }
    const argv = ["ls-files"];
    if (this.#cached) argv.push("--cached");
    if (this.#modified) argv.push("--modified");
    if (this.#deleted) argv.push("--deleted");
    if (this.#others) argv.push("--others");
    if (this.#ignored) argv.push("--ignored");
    if (this.#stage) argv.push("--stage");
    if (this.#excludeStandard) argv.push("--exclude-standard");
    if (this.#directory) argv.push("--directory");
    if (this.#errorUnmatch) argv.push("--error-unmatch");
    if (this.#nul) argv.push("-z");
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/**
 * Run `git ls-files -z` and split it into paths. Backs
 * {@link "./git.ts".GitTasks.lsFileNames}.
 */
export async function readLsFileNames(
  configure?: Configure<GitLsFilesSettings>,
): Promise<string[]> {
  const settings = new GitLsFilesSettings();
  const configured = configure ? configure(settings) : settings;
  configured.nulTerminated();
  // `--stage` prefixes every record with a mode, object name, and stage
  // number, so the records would no longer be paths. Say so rather than
  // handing back a list of mangled ones.
  if (configured.argv().includes("--stage")) {
    throw new Error(
      "GitTasks.lsFileNames: .stage() prefixes each entry with its mode and " +
        "object name, so the records are not paths — use GitTasks.lsFiles to " +
        "read that listing.",
    );
  }
  const output = await configured.run();
  return splitNul(output.stdout);
}
