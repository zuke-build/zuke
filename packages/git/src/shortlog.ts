// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git shortlog` — commits grouped by the person who wrote them, which is how
 * a release note names its contributors.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const authors = await GitTasks.shortlogEntries((s) =>
 *   s.email().commits("v1.0.0..HEAD")
 * );
 * ```
 *
 * {@link "./git.ts".GitTasks.shortlogEntries} forces the summary form, whose
 * one-line-per-author output is the only shape that parses back to a count.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { requireCompleteOutput } from "./complete_output.ts";

/** Settings for `git shortlog`. */
export class GitShortlogSettings extends GitSettings {
  #summary = false;
  #numbered = false;
  #email = false;
  #committer = false;
  #group: string[] = [];
  #commits: string[] = [];
  #paths: string[] = [];

  /**
   * Report only the commit count per author, without the subjects (`-s`).
   * Prefer {@link "./git.ts".GitTasks.shortlogEntries}, which reads that
   * output back.
   */
  summary(): this {
    this.#summary = true;
    return this;
  }

  /** Sort by commit count rather than by name (`-n`). */
  numbered(): this {
    this.#numbered = true;
    return this;
  }

  /** Include each author's email address (`-e`). */
  email(): this {
    this.#email = true;
    return this;
  }

  /** Group by committer rather than author (`-c`). */
  committer(): this {
    this.#committer = true;
    return this;
  }

  /** Group by a named field (`--group=<field>`), e.g. `"trailer:co-authored-by"`. */
  group(...fields: string[]): this {
    this.#group.push(...fields);
    return this;
  }

  /** The revision range to summarise (positional); repeatable. */
  commits(...values: string[]): this {
    this.#commits.push(...values);
    return this;
  }

  /** Limit the summary to commits touching these paths (positional). */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git shortlog` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["shortlog"];
    if (this.#summary) argv.push("-s");
    if (this.#numbered) argv.push("-n");
    if (this.#email) argv.push("-e");
    if (this.#committer) argv.push("-c");
    for (const field of this.#group) argv.push(`--group=${field}`);
    argv.push(...this.#commits);
    // `--` so a pathspec is never mistaken for a revision.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** One line of `git shortlog -s`: a contributor and how many commits they have. */
export interface GitShortlogEntry {
  /** How many commits the group holds. */
  count: number;
  /** The contributor's name, as recorded on the commits. */
  name: string;
  /** Their email address; present only when `-e` asked for it. */
  email?: string;
}

/**
 * Parse `git shortlog -s` into entries. Each line is the count, right-aligned
 * in spaces, then a tab, then the name — and with `-e`, the name is followed
 * by the address in angle brackets.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseShortlogEntries(stdout: string): GitShortlogEntry[] {
  const entries: GitShortlogEntry[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    // Without a tab the line is not a summary row: the non-summary format
    // indents commit subjects under each author instead.
    if (tab === -1) continue;
    // git right-aligns a plain non-negative integer here. Number() would also
    // accept "-3" and "1e3" and hand back a confident -3 or 1000, so match the
    // shape git actually emits rather than whatever parses.
    const counted = line.slice(0, tab).trim();
    if (!/^\d+$/.test(counted)) continue;
    const count = Number(counted);
    const who = line.slice(tab + 1);
    // A name may itself contain angle brackets, so anchor on the last pair —
    // git appends the address, and only with -e.
    const open = who.lastIndexOf(" <");
    if (open !== -1 && who.endsWith(">")) {
      entries.push({
        count,
        name: who.slice(0, open),
        email: who.slice(open + 2, -1),
      });
    } else {
      entries.push({ count, name: who });
    }
  }
  return entries;
}

/**
 * Run `git shortlog -s` and parse it. Backs
 * {@link "./git.ts".GitTasks.shortlogEntries}.
 *
 * Given no revision range, `git shortlog` summarises **stdin** rather than the
 * repository — it is designed to sit downstream of `git log`. In a build that
 * means an empty answer when stdin is closed, and a wait when it is an open
 * pipe; neither looks like a failure. So this reader supplies `HEAD` when the
 * caller named no revision, and the summary is of history either way.
 */
export async function readShortlogEntries(
  configure?: Configure<GitShortlogSettings>,
): Promise<GitShortlogEntry[]> {
  const settings = new GitShortlogSettings();
  const configured = configure ? configure(settings) : settings;
  configured.summary();
  const argv = configured.argv();
  // Everything after the subcommand that is not a flag, a flag's value, or the
  // pathspec separator is the revision range the caller supplied.
  const shortlogAt = argv.indexOf("shortlog");
  const rest = argv.slice(shortlogAt + 1);
  const separator = rest.indexOf("--");
  const beforePaths = separator === -1 ? rest : rest.slice(0, separator);
  if (!beforePaths.some((arg) => !arg.startsWith("-"))) {
    configured.commits("HEAD");
  }
  const output = await configured.quiet().run();
  requireCompleteOutput(output, "shortlogEntries");
  return parseShortlogEntries(output.stdout);
}
