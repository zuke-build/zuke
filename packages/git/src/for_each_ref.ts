// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git for-each-ref`, `git show-ref`, `git symbolic-ref` and `git name-rev` —
 * the commands that answer what refs exist and what they point at.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const tags = await GitTasks.refs((s) =>
 *   s.patterns("refs/tags/").sort("-creatordate").count(10)
 * );
 * const head = await GitTasks.symbolicRef((s) => s.name("HEAD").short());
 * ```
 *
 * {@link "./git.ts".GitTasks.refs} is the reader. It pins `--format` to a
 * NUL-delimited record of its own rather than exposing git's format language,
 * because a caller-supplied format would let the fields it parses move out
 * from under it — see {@link REF_ENTRY_FORMAT}.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** The four fields the ref reader asks for, in the order it parses them. */
const REF_FIELDS = ["objectname", "objecttype", "refname", "upstream"] as const;

/**
 * The `--format` {@link "./git.ts".GitTasks.refs} pins: the fields of one ref,
 * separated by NUL and terminated by one, so a ref name cannot break a record.
 *
 * `%00` is git's own NUL placeholder, which is why the reader can rely on the
 * separator surviving a ref name containing anything else.
 */
export const REF_ENTRY_FORMAT: string = REF_FIELDS
  .map((field) => `%(${field})`)
  .join("%00") + "%00";

/** Settings for `git for-each-ref`. */
export class GitForEachRefSettings extends GitSettings {
  #format?: string;
  #count?: number;
  #sort: string[] = [];
  #excludes: string[] = [];
  #pointsAt?: string;
  #merged?: string;
  #noMerged?: string;
  #contains?: string;
  #noContains?: string;
  #ignoreCase = false;
  #omitEmpty = false;
  #patterns: string[] = [];

  /** The output format (`--format=<format>`), in git's placeholder language. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Show only this many matched refs (`--count=<n>`). */
  count(value: number): this {
    this.#count = value;
    return this;
  }

  /**
   * Sort by a field (`--sort=<key>`), e.g. `"-creatordate"` for newest first;
   * repeatable, and git applies the keys in the order given.
   */
  sort(...keys: string[]): this {
    this.#sort.push(...keys);
    return this;
  }

  /** Exclude refs matching a pattern (`--exclude=<pattern>`); repeatable. */
  exclude(...patterns: string[]): this {
    this.#excludes.push(...patterns);
    return this;
  }

  /** Only refs pointing at this object (`--points-at=<object>`). */
  pointsAt(object: string): this {
    this.#pointsAt = object;
    return this;
  }

  /** Only refs merged into this commit (`--merged=<commit>`). */
  merged(commit: string): this {
    this.#merged = commit;
    return this;
  }

  /** Only refs not merged into this commit (`--no-merged=<commit>`). */
  noMerged(commit: string): this {
    this.#noMerged = commit;
    return this;
  }

  /** Only refs whose history contains this commit (`--contains=<commit>`). */
  contains(commit: string): this {
    this.#contains = commit;
    return this;
  }

  /** Only refs not containing this commit (`--no-contains=<commit>`). */
  noContains(commit: string): this {
    this.#noContains = commit;
    return this;
  }

  /** Sort and filter case-insensitively (`--ignore-case`). */
  ignoreCase(): this {
    this.#ignoreCase = true;
    return this;
  }

  /** Skip the newline after a ref that formats to nothing (`--omit-empty`). */
  omitEmpty(): this {
    this.#omitEmpty = true;
    return this;
  }

  /** The ref patterns to match (positional), e.g. `"refs/tags/"`; repeatable. */
  patterns(...values: string[]): this {
    this.#patterns.push(...values);
    return this;
  }

  /** Assemble the `git for-each-ref` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#merged !== undefined && this.#noMerged !== undefined) {
      throw new Error(
        "GitTasks.forEachRef: .merged() and .noMerged() select disjoint sets " +
          "of refs, so together they match nothing — keep one.",
      );
    }
    const argv = ["for-each-ref"];
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    if (this.#count !== undefined) argv.push(`--count=${this.#count}`);
    for (const key of this.#sort) argv.push(`--sort=${key}`);
    for (const pattern of this.#excludes) argv.push(`--exclude=${pattern}`);
    if (this.#pointsAt !== undefined) {
      argv.push(`--points-at=${this.#pointsAt}`);
    }
    if (this.#merged !== undefined) argv.push(`--merged=${this.#merged}`);
    if (this.#noMerged !== undefined) {
      argv.push(`--no-merged=${this.#noMerged}`);
    }
    if (this.#contains !== undefined) argv.push(`--contains=${this.#contains}`);
    if (this.#noContains !== undefined) {
      argv.push(`--no-contains=${this.#noContains}`);
    }
    if (this.#ignoreCase) argv.push("--ignore-case");
    if (this.#omitEmpty) argv.push("--omit-empty");
    argv.push(...this.#patterns);
    return argv;
  }
}

/** One ref from `git for-each-ref`, as {@link REF_ENTRY_FORMAT} reports it. */
export interface GitRef {
  /** The object the ref points at, as a full object name. */
  objectName: string;
  /** The kind of object: `commit`, `tag`, `tree`, or `blob`. */
  objectType: string;
  /** The full ref name, e.g. `refs/tags/v1.0.0`. */
  refName: string;
  /** The upstream this ref tracks, if it has one. */
  upstream?: string;
}

/**
 * Parse the NUL-delimited records {@link REF_ENTRY_FORMAT} produces.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseRefs(stdout: string): GitRef[] {
  const fields = stdout.split("\0");
  const refs: GitRef[] = [];
  // Each ref contributes exactly REF_FIELDS.length fields; a trailing partial
  // group is a truncated read and has no complete ref to report.
  for (
    let i = 0;
    i + REF_FIELDS.length <= fields.length;
    i += REF_FIELDS.length
  ) {
    const [objectName, objectType, refName, upstream] = fields.slice(
      i,
      i + REF_FIELDS.length,
    );
    // git separates records with the format's trailing NUL plus a newline, so
    // the first field of every record after the first carries that newline.
    const name = (objectName ?? "").replace(/^\n/, "");
    if (name === "" || refName === undefined || objectType === undefined) {
      continue;
    }
    const ref: GitRef = {
      objectName: name,
      objectType,
      refName,
    };
    if (upstream !== undefined && upstream !== "") ref.upstream = upstream;
    refs.push(ref);
  }
  return refs;
}

/**
 * Run `git for-each-ref` with the pinned format and parse it. Backs
 * {@link "./git.ts".GitTasks.refs}.
 *
 * A caller-supplied `.format(...)` is refused rather than overridden: the
 * parser reads the fields of {@link REF_ENTRY_FORMAT} by position, so honouring
 * another format would return confidently mislabelled values.
 */
export async function readRefs(
  configure?: Configure<GitForEachRefSettings>,
): Promise<GitRef[]> {
  const settings = new GitForEachRefSettings();
  const configured = configure ? configure(settings) : settings;
  if (configured.argv().some((arg) => arg.startsWith("--format="))) {
    throw new Error(
      "GitTasks.refs: .format() would move the fields this reader parses by " +
        "position — drop it, or use GitTasks.forEachRef to read that output " +
        "yourself.",
    );
  }
  const output = await configured.format(REF_ENTRY_FORMAT).quiet().run();
  return parseRefs(output.stdout);
}

/** Settings for `git show-ref`. */
export class GitShowRefSettings extends GitSettings {
  #tags = false;
  #heads = false;
  #head = false;
  #dereference = false;
  #hash = false;
  #verify = false;
  #exists = false;
  #quietOutput = false;
  #abbrev?: number;
  #patterns: string[] = [];

  /** Only tags (`--tags`); may be combined with {@link heads}. */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Only branch heads (`--heads`); may be combined with {@link tags}. */
  heads(): this {
    this.#heads = true;
    return this;
  }

  /** Include `HEAD` even when a filter would exclude it (`--head`). */
  head(): this {
    this.#head = true;
    return this;
  }

  /** Dereference tags into the objects they point at (`--dereference`). */
  dereference(): this {
    this.#dereference = true;
    return this;
  }

  /** Print only the object name, without the ref (`--hash`). */
  hash(): this {
    this.#hash = true;
    return this;
  }

  /** Require an exact ref path and fail otherwise (`--verify`). */
  verify(): this {
    this.#verify = true;
    return this;
  }

  /** Check a ref exists without resolving it (`--exists`). */
  exists(): this {
    this.#exists = true;
    return this;
  }

  /**
   * Suppress git's own stdout (`--quiet`), leaving the exit status as the
   * answer — the useful pairing with {@link verify}.
   *
   * Named apart from the inherited `quiet`, which silences Zuke's echo of the
   * command rather than git's output.
   */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** Abbreviate object names to this many digits (`--abbrev=<n>`). */
  abbrev(digits: number): this {
    this.#abbrev = digits;
    return this;
  }

  /** The ref patterns to show (positional); repeatable. */
  patterns(...values: string[]): this {
    this.#patterns.push(...values);
    return this;
  }

  /** Assemble the `git show-ref` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#verify && this.#exists) {
      throw new Error(
        "GitTasks.showRef: --verify and --exists are separate usages of git " +
          "show-ref — pick one.",
      );
    }
    const argv = ["show-ref"];
    if (this.#tags) argv.push("--tags");
    if (this.#heads) argv.push("--heads");
    if (this.#head) argv.push("--head");
    if (this.#dereference) argv.push("--dereference");
    if (this.#hash) argv.push("--hash");
    if (this.#verify) argv.push("--verify");
    if (this.#exists) argv.push("--exists");
    if (this.#quietOutput) argv.push("--quiet");
    if (this.#abbrev !== undefined) argv.push(`--abbrev=${this.#abbrev}`);
    // `--` so a ref pattern beginning with `-` is never read as a flag.
    if (this.#patterns.length > 0) argv.push("--", ...this.#patterns);
    return argv;
  }
}

/** Settings for `git symbolic-ref`. */
export class GitSymbolicRefSettings extends GitSettings {
  #name?: string;
  #ref?: string;
  #short = false;
  #delete = false;
  #quietOutput = false;
  #reason?: string;

  /** The symbolic ref to read or set (positional), e.g. `"HEAD"`. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The ref to point it at (positional), which makes this a write. */
  ref(value: string): this {
    this.#ref = value;
    return this;
  }

  /** Shorten the reported ref name (`--short`). */
  short(): this {
    this.#short = true;
    return this;
  }

  /** Delete the symbolic ref (`--delete`). */
  delete(): this {
    this.#delete = true;
    return this;
  }

  /**
   * Say nothing and exit non-zero when the ref is not symbolic (`--quiet`).
   *
   * Named apart from the inherited `quiet`, which silences Zuke's echo.
   */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** The reflog reason to record for the update (`-m <reason>`). */
  reason(value: string): this {
    this.#reason = value;
    return this;
  }

  /** Assemble the `git symbolic-ref` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GitTasks.symbolicRef: no ref named — add .name('HEAD'), since git " +
          "symbolic-ref needs the ref to read or set.",
      );
    }
    if (this.#short && this.#ref !== undefined) {
      throw new Error(
        "GitTasks.symbolicRef: .short() shortens output, but .ref() makes " +
          "this a write that prints nothing — drop one.",
      );
    }
    const argv = ["symbolic-ref"];
    if (this.#short) argv.push("--short");
    if (this.#delete) argv.push("--delete");
    if (this.#quietOutput) argv.push("--quiet");
    if (this.#reason !== undefined) argv.push("-m", this.#reason);
    argv.push(this.#name);
    if (this.#ref !== undefined) argv.push(this.#ref);
    return argv;
  }
}

/** Settings for `git name-rev`. */
export class GitNameRevSettings extends GitSettings {
  #tags = false;
  #all = false;
  #nameOnly = false;
  #alwaysName = false;
  #refs: string[] = [];
  #commits: string[] = [];

  /** Use only tags to name the commits (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Name every reachable commit (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Print only the name, not the commit it names (`--name-only`). */
  nameOnly(): this {
    this.#nameOnly = true;
    return this;
  }

  /** Fall back to the object name when nothing else names it (`--always`). */
  alwaysName(): this {
    this.#alwaysName = true;
    return this;
  }

  /** Only consider refs matching these patterns (`--refs=<pattern>`). */
  refs(...patterns: string[]): this {
    this.#refs.push(...patterns);
    return this;
  }

  /** The commits to name (positional); repeatable. */
  commits(...values: string[]): this {
    this.#commits.push(...values);
    return this;
  }

  /** Assemble the `git name-rev` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#commits.length === 0 && !this.#all) {
      throw new Error(
        "GitTasks.nameRev: no commits given — add .commits('HEAD'), or " +
          ".all() to name every reachable commit.",
      );
    }
    const argv = ["name-rev"];
    if (this.#tags) argv.push("--tags");
    if (this.#all) argv.push("--all");
    if (this.#nameOnly) argv.push("--name-only");
    if (this.#alwaysName) argv.push("--always");
    for (const pattern of this.#refs) argv.push(`--refs=${pattern}`);
    argv.push(...this.#commits);
    return argv;
  }
}
