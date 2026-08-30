// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git blame` — which commit last touched each line of a file.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const lines = await GitTasks.blameLines((s) =>
 *   s.file("packages/core/mod.ts").lineRange(1, 40)
 * );
 * ```
 *
 * {@link "./git.ts".GitTasks.blameLines} reads the `--porcelain` form, which is
 * the only one whose fields are stable — the default output is laid out for a
 * terminal and its columns shift with the data.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { requireCompleteOutput } from "./complete_output.ts";

/** Settings for `git blame`. */
export class GitBlameSettings extends GitSettings {
  #file?: string;
  #porcelain = false;
  #linePorcelain = false;
  #revision?: string;
  #ranges: string[] = [];
  #showEmail = false;
  #ignoreWhitespace = false;
  #reverse?: string;
  #ignoreRevs: string[] = [];

  /** The file to annotate (positional). */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /**
   * Machine-readable output (`--porcelain`). Prefer
   * {@link "./git.ts".GitTasks.blameLines}, which parses it.
   */
  porcelain(): this {
    this.#porcelain = true;
    return this;
  }

  /**
   * Like {@link porcelain}, but repeating the commit header on every line
   * (`--line-porcelain`) rather than only its first appearance.
   */
  linePorcelain(): this {
    this.#linePorcelain = true;
    return this;
  }

  /** Annotate the file as of this revision (positional). */
  revision(value: string): this {
    this.#revision = value;
    return this;
  }

  /** Annotate only these lines (`-L <start>,<end>`); repeatable. */
  lineRange(start: number, end: number | string): this {
    this.#ranges.push(`${start},${end}`);
    return this;
  }

  /** Show the author's email rather than their name (`-e`). */
  showEmail(): this {
    this.#showEmail = true;
    return this;
  }

  /** Ignore whitespace-only changes when assigning blame (`-w`). */
  ignoreWhitespace(): this {
    this.#ignoreWhitespace = true;
    return this;
  }

  /** Walk history forward from this revision instead (`--reverse <rev>`). */
  reverse(value: string): this {
    this.#reverse = value;
    return this;
  }

  /** Ignore a revision when assigning blame (`--ignore-rev`); repeatable. */
  ignoreRevs(...revisions: string[]): this {
    this.#ignoreRevs.push(...revisions);
    return this;
  }

  /** Assemble the `git blame` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#file === undefined) {
      throw new Error(
        "GitTasks.blame: no file given — add .file('path'), since git blame " +
          "annotates one file at a time.",
      );
    }
    if (this.#porcelain && this.#linePorcelain) {
      throw new Error(
        "GitTasks.blame: .porcelain() and .linePorcelain() are two forms of " +
          "the same output — pick one.",
      );
    }
    const argv = ["blame"];
    if (this.#porcelain) argv.push("--porcelain");
    if (this.#linePorcelain) argv.push("--line-porcelain");
    if (this.#showEmail) argv.push("-e");
    if (this.#ignoreWhitespace) argv.push("-w");
    if (this.#reverse !== undefined) argv.push("--reverse", this.#reverse);
    for (const rev of this.#ignoreRevs) argv.push("--ignore-rev", rev);
    for (const range of this.#ranges) argv.push("-L", range);
    if (this.#revision !== undefined) argv.push(this.#revision);
    // `--` so a filename beginning with `-`, or one that also names a
    // revision, is unambiguously the file.
    argv.push("--", this.#file);
    return argv;
  }
}

/** One annotated line of `git blame --porcelain`. */
export interface GitBlameLine {
  /** The commit that last touched this line. */
  commit: string;
  /** The line number in the file as it is now, 1-based. */
  lineNumber: number;
  /** The line number in the commit the content came from, 1-based. */
  originalLineNumber: number;
  /** The line's content, without its terminator. */
  content: string;
  /** The author's name, as recorded on the commit. */
  author?: string;
  /** The author's email address, with the angle brackets removed. */
  authorMail?: string;
  /** The commit's subject line. */
  summary?: string;
  /** The file the line came from, which differs from the target after a rename. */
  filename?: string;
}

/** The commit metadata `--porcelain` reports once per commit, not per line. */
interface CommitMeta {
  author?: string;
  authorMail?: string;
  summary?: string;
  filename?: string;
}

/** Strip the angle brackets git wraps an address in. */
function stripAngleBrackets(value: string): string {
  return value.startsWith("<") && value.endsWith(">")
    ? value.slice(1, -1)
    : value;
}

/**
 * Parse `git blame --porcelain` into annotated lines.
 *
 * The format's one trap is that a commit's metadata — author, summary,
 * filename — appears only on that commit's **first** line in the output.
 * Every later line from the same commit carries the header alone, so the
 * metadata has to be remembered per commit and carried forward, which is what
 * the `commits` map here does. A parser that read each record independently
 * would report an author for the first line of each commit and nothing for the
 * rest.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseBlameLines(stdout: string): GitBlameLine[] {
  const commits = new Map<string, CommitMeta>();
  const lines: GitBlameLine[] = [];
  let current: { commit: string; original: number; final: number } | undefined;
  for (const raw of stdout.split("\n")) {
    // The content of an annotated line is the only one git indents with a tab.
    if (raw.startsWith("\t")) {
      if (current === undefined) continue;
      const meta = commits.get(current.commit) ?? {};
      const line: GitBlameLine = {
        commit: current.commit,
        lineNumber: current.final,
        originalLineNumber: current.original,
        content: raw.slice(1),
      };
      if (meta.author !== undefined) line.author = meta.author;
      if (meta.authorMail !== undefined) line.authorMail = meta.authorMail;
      if (meta.summary !== undefined) line.summary = meta.summary;
      if (meta.filename !== undefined) line.filename = meta.filename;
      lines.push(line);
      current = undefined;
      continue;
    }
    const header = /^([0-9a-f]{7,64}) (\d+) (\d+)(?: \d+)?$/.exec(raw);
    if (header !== null) {
      const [, commit, original, final] = header;
      // The capture groups are all present when the pattern matched; the guard
      // is what lets the values be read without a non-null assertion.
      if (
        commit === undefined || original === undefined || final === undefined
      ) {
        continue;
      }
      current = {
        commit,
        original: Number(original),
        final: Number(final),
      };
      if (!commits.has(commit)) commits.set(commit, {});
      continue;
    }
    if (current === undefined) continue;
    const meta = commits.get(current.commit);
    if (meta === undefined) continue;
    const space = raw.indexOf(" ");
    const key = space === -1 ? raw : raw.slice(0, space);
    const value = space === -1 ? "" : raw.slice(space + 1);
    if (key === "author") meta.author = value;
    else if (key === "author-mail") meta.authorMail = stripAngleBrackets(value);
    else if (key === "summary") meta.summary = value;
    else if (key === "filename") meta.filename = value;
  }
  return lines;
}

/**
 * Run `git blame --porcelain` and parse it. Backs
 * {@link "./git.ts".GitTasks.blameLines}.
 */
export async function readBlameLines(
  configure?: Configure<GitBlameSettings>,
): Promise<GitBlameLine[]> {
  const settings = new GitBlameSettings();
  const configured = configure ? configure(settings) : settings;
  // `--line-porcelain` repeats the metadata on every line, which this parser
  // also handles; only add `--porcelain` when neither form was asked for, so a
  // caller's choice is not overridden into a form git rejects alongside it.
  if (!configured.argv().includes("--line-porcelain")) {
    configured.porcelain();
  }
  const output = await configured.quiet().run();
  requireCompleteOutput(output, "blameLines");
  return parseBlameLines(output.stdout);
}
