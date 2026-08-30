// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git check-ignore` — whether a path is excluded by the ignore rules.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * if (await GitTasks.isIgnored((s) => s.paths("cov_profile"))) {
 *   // the coverage artifacts are excluded, as they should be
 * }
 * ```
 *
 * {@link "./git.ts".GitTasks.isIgnored} is the reader whose answer is an exit
 * status — see {@link readIsIgnored} for the three outcomes that status
 * actually carries.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { yesNoFromStatus } from "./status_answer.ts";

/** Settings for `git check-ignore`. */
export class GitCheckIgnoreSettings extends GitSettings {
  #quietOutput = false;
  #verbose = false;
  #nonMatching = false;
  #noIndex = false;
  #nul = false;
  #paths: string[] = [];

  /**
   * Say nothing and answer by exit status alone (`-q`).
   *
   * Named apart from the inherited `quiet`, which silences Zuke's echo of the
   * command rather than git's output.
   */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** Also report the rule that excluded each path (`-v`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Include the paths that are *not* excluded (`-n`); needs {@link verbose}. */
  nonMatching(): this {
    this.#nonMatching = true;
    return this;
  }

  /** Ignore the index when checking (`--no-index`). */
  noIndex(): this {
    this.#noIndex = true;
    return this;
  }

  /** Terminate records with NUL rather than newline (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** The paths to check (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git check-ignore` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "GitTasks.checkIgnore: no paths given — add .paths('build/'), since " +
          "git check-ignore needs the paths to test.",
      );
    }
    // git refuses this pairing outright: -n reports why a path did *not*
    // match, which only the verbose format has a column for.
    if (this.#nonMatching && !this.#verbose) {
      throw new Error(
        "GitTasks.checkIgnore: .nonMatching() needs .verbose() — git rejects " +
          "-n without -v, because the non-matching rows only exist in the " +
          "verbose format.",
      );
    }
    // git refuses this pairing too: -q answers by status alone, which leaves
    // the verbose format nothing to print into.
    if (this.#quietOutput && this.#verbose) {
      throw new Error(
        "GitTasks.checkIgnore: .quietOutput() and .verbose() are opposites — " +
          'git rejects them together ("cannot have both --quiet and ' +
          '--verbose"). Keep one.',
      );
    }
    const argv = ["check-ignore"];
    if (this.#quietOutput) argv.push("-q");
    if (this.#verbose) argv.push("-v");
    if (this.#nonMatching) argv.push("-n");
    if (this.#noIndex) argv.push("--no-index");
    if (this.#nul) argv.push("-z");
    // `--` so a path beginning with `-` is never read as a flag.
    argv.push("--", ...this.#paths);
    return argv;
  }
}

/**
 * Run `git check-ignore -q` and read its exit status as a boolean. Backs
 * {@link "./git.ts".GitTasks.isIgnored}.
 *
 * As with `merge-base --is-ancestor`, the status carries three outcomes rather
 * than two: `0` means at least one path is excluded, `1` means none is, and
 * anything else is git failing — `128` for a path it cannot resolve or a
 * missing argument. Treating any non-zero status as "not ignored" would report
 * those failures as a legitimate answer.
 */
export async function readIsIgnored(
  configure?: Configure<GitCheckIgnoreSettings>,
): Promise<boolean> {
  const settings = new GitCheckIgnoreSettings();
  const configured = configure ? configure(settings) : settings;
  // This reader answers from the exit status, so it forces -q. A caller's
  // .verbose() would make that pairing one git rejects, and .nonMatching()
  // needs .verbose() — so both are refused here by name rather than surfacing
  // as an opaque exit 128.
  const output = await configured.quietOutput().quiet().noThrow().run();
  return yesNoFromStatus(output, {
    task: "isIgnored",
    command: "git check-ignore",
  });
}
