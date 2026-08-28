// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git log` and `git show` — reading history, either printed or parsed.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.log((s) => s.maxCount(20).oneline());
 * const commits = await GitTasks.logEntries((s) => s.range("v1.2.0", "HEAD"));
 * await GitTasks.show((s) => s.object("HEAD:AGENTS.md"));
 * ```
 *
 * {@link "./git.ts".GitTasks.logEntries} is the one that hands back values. It
 * pins its own `--format`, whose fields are separated by the ASCII unit and
 * record separators rather than by newlines — a commit message contains
 * newlines, blank lines, and anything else a naive line parser would trip on,
 * but it cannot contain a `0x1f`.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git log`. */
export class GitLogSettings extends GitSettings {
  #revisions: string[] = [];
  #paths: string[] = [];
  #maxCount?: number;
  #skip?: number;
  #oneline = false;
  #format?: string;
  #since?: string;
  #until?: string;
  #authors: string[] = [];
  #greps: string[] = [];
  #noMerges = false;
  #firstParent = false;
  #reverse = false;
  #follow = false;

  /** Revisions to walk (positional), e.g. `HEAD` or `origin/main`; repeatable. */
  revisions(...revs: string[]): this {
    this.#revisions.push(...revs);
    return this;
  }

  /**
   * Walk the commits in `from..to` — what is on `to` and not on `from`, the
   * range a changelog since the last tag is built from. `to` defaults to
   * `HEAD`.
   */
  range(from: string, to = "HEAD"): this {
    this.#revisions.push(`${from}..${to}`);
    return this;
  }

  /** Limit the walk to these pathspecs (positional, after `--`); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Stop after this many commits (`--max-count=<n>`). */
  maxCount(count: number): this {
    this.#maxCount = count;
    return this;
  }

  /** Skip this many commits before reporting any (`--skip=<n>`). */
  skip(count: number): this {
    this.#skip = count;
    return this;
  }

  /** One abbreviated line per commit (`--oneline`). */
  oneline(): this {
    this.#oneline = true;
    return this;
  }

  /**
   * Render each commit through a format string (`--format=<fmt>`), e.g.
   * `%H %s`. Given after {@link oneline}, so it wins when both are set.
   */
  format(spec: string): this {
    this.#format = spec;
    return this;
  }

  /** Only commits more recent than this date (`--since=<date>`). */
  since(date: string): this {
    this.#since = date;
    return this;
  }

  /** Only commits older than this date (`--until=<date>`). */
  until(date: string): this {
    this.#until = date;
    return this;
  }

  /** Only commits whose author matches this pattern (`--author=`); repeatable. */
  author(...patterns: string[]): this {
    this.#authors.push(...patterns);
    return this;
  }

  /** Only commits whose message matches this pattern (`--grep=`); repeatable. */
  grep(...patterns: string[]): this {
    this.#greps.push(...patterns);
    return this;
  }

  /** Skip merge commits (`--no-merges`). */
  noMerges(): this {
    this.#noMerges = true;
    return this;
  }

  /** Follow only the first parent of a merge (`--first-parent`). */
  firstParent(): this {
    this.#firstParent = true;
    return this;
  }

  /** Report oldest first (`--reverse`). */
  reverse(): this {
    this.#reverse = true;
    return this;
  }

  /** Keep following a single file across renames (`--follow`). */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** Assemble the `git log` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#follow && this.#paths.length !== 1) {
      throw new Error(
        "GitTasks.log: .follow() tracks one file across renames — give " +
          "exactly one path to .paths(...).",
      );
    }
    const argv = ["log"];
    if (this.#maxCount !== undefined) {
      argv.push(`--max-count=${this.#maxCount}`);
    }
    if (this.#skip !== undefined) argv.push(`--skip=${this.#skip}`);
    if (this.#noMerges) argv.push("--no-merges");
    if (this.#firstParent) argv.push("--first-parent");
    if (this.#reverse) argv.push("--reverse");
    if (this.#follow) argv.push("--follow");
    if (this.#since !== undefined) argv.push(`--since=${this.#since}`);
    if (this.#until !== undefined) argv.push(`--until=${this.#until}`);
    for (const author of this.#authors) argv.push(`--author=${author}`);
    for (const pattern of this.#greps) argv.push(`--grep=${pattern}`);
    // `--format` last of the two so it wins when a caller set both; git takes
    // the final formatting option it is given.
    if (this.#oneline) argv.push("--oneline");
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    argv.push(...this.#revisions);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** Settings for `git show`. */
export class GitShowSettings extends GitSettings {
  #objects: string[] = [];
  #paths: string[] = [];
  #format?: string;
  #noPatch = false;
  #nameOnly = false;
  #nameStatus = false;
  #stat = false;

  /**
   * The objects to show (positional); repeatable. A commit, a tag, or a blob
   * at a revision such as `HEAD:deno.json` — the way a build reads a file as
   * it was, without checking anything out.
   */
  object(...names: string[]): this {
    this.#objects.push(...names);
    return this;
  }

  /** Limit the output to these pathspecs (positional, after `--`); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Render the commit header through a format string (`--format=<fmt>`). */
  format(spec: string): this {
    this.#format = spec;
    return this;
  }

  /** Suppress the diff (`--no-patch`), leaving only the header. */
  noPatch(): this {
    this.#noPatch = true;
    return this;
  }

  /** List the changed paths instead of the diff (`--name-only`). */
  nameOnly(): this {
    this.#nameOnly = true;
    return this;
  }

  /** List the changed paths with their status letters (`--name-status`). */
  nameStatus(): this {
    this.#nameStatus = true;
    return this;
  }

  /** Summarise the changes (`--stat`). */
  stat(): this {
    this.#stat = true;
    return this;
  }

  /** Assemble the `git show` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["show"];
    if (this.#noPatch) argv.push("--no-patch");
    if (this.#nameStatus) argv.push("--name-status");
    if (this.#nameOnly) argv.push("--name-only");
    if (this.#stat) argv.push("--stat");
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    argv.push(...this.#objects);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** One commit of {@link "./git.ts".GitTasks.logEntries}. */
export interface GitCommitEntry {
  /** The full commit SHA (`%H`). */
  commit: string;
  /** The abbreviated commit SHA (`%h`). */
  shortCommit: string;
  /** The parent SHAs (`%P`); two or more mean a merge, none the root commit. */
  parents: string[];
  /** The author's name (`%an`). */
  authorName: string;
  /** The author's email (`%ae`). */
  authorEmail: string;
  /** When the commit was authored, ISO 8601 (`%aI`). */
  authoredAt: string;
  /** When the commit was committed, ISO 8601 (`%cI`). */
  committedAt: string;
  /** The first line of the message (`%s`). */
  subject: string;
  /** The rest of the message (`%B` after the subject), trailing newlines trimmed. */
  body: string;
}

/** The field separator inside a record: ASCII unit separator, `%x1f`. */
const UNIT = "\x1f";

/** The separator between records: ASCII record separator, `%x1e`. */
const RECORD = "\x1e";

/**
 * The `--format` {@link readLogEntries} pins. Fields in {@link GitCommitEntry}
 * order, separated by `%x1f`, each commit terminated by `%x1e` — separators no
 * commit message can contain, unlike the newlines a line-oriented format would
 * rely on.
 */
export const LOG_ENTRY_FORMAT: string = [
  "%H",
  "%h",
  "%P",
  "%an",
  "%ae",
  "%aI",
  "%cI",
  "%s",
  "%b",
].join("%x1f") + "%x1e";

/**
 * Parse the output of a `git log` run with {@link LOG_ENTRY_FORMAT}. A record
 * with too few fields is skipped rather than reported half-filled — the only
 * way to produce one is a truncated read.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseLogEntries(stdout: string): GitCommitEntry[] {
  const entries: GitCommitEntry[] = [];
  for (const record of stdout.split(RECORD)) {
    // git puts a newline between records; it belongs to neither.
    const text = record.replace(/^\r?\n/, "");
    if (text.trim() === "") continue;
    const fields = text.split(UNIT);
    if (fields.length < 9) continue;
    const [
      commit,
      shortCommit,
      parents,
      name,
      email,
      authored,
      committed,
      subject,
    ] = fields;
    if (
      commit === undefined || shortCommit === undefined ||
      parents === undefined || name === undefined || email === undefined ||
      authored === undefined || committed === undefined ||
      subject === undefined
    ) {
      continue;
    }
    // The body is the last field, so everything past the eighth separator is
    // part of it — including a separator a commit message itself contained.
    const body = fields.slice(8).join(UNIT);
    entries.push({
      commit,
      shortCommit,
      parents: parents.split(" ").filter((sha) => sha !== ""),
      authorName: name,
      authorEmail: email,
      authoredAt: authored,
      committedAt: committed,
      subject,
      body: body.replace(/\s+$/, ""),
    });
  }
  return entries;
}

/**
 * Run `git log` with {@link LOG_ENTRY_FORMAT} and parse it. Backs
 * {@link "./git.ts".GitTasks.logEntries}.
 */
export async function readLogEntries(
  configure?: Configure<GitLogSettings>,
): Promise<GitCommitEntry[]> {
  const settings = new GitLogSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.format(LOG_ENTRY_FORMAT).run();
  return parseLogEntries(output.stdout);
}
