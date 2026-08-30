// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git ls-tree` and `git cat-file` — reading what a tree holds, and the
 * contents of an object, without checking anything out.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const entries = await GitTasks.treeEntries((s) => s.tree("HEAD").recursive());
 * const manifest = await GitTasks.blobText((s) => s.object("v1.0.0:deno.json"));
 * ```
 *
 * Both readers exist because the alternative is a checkout: answering "what did
 * this file look like at that tag" by moving the working tree is slow and
 * destroys whatever was there.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { splitNul } from "./nul_records.ts";

/** Settings for `git ls-tree`. */
export class GitLsTreeSettings extends GitSettings {
  #tree?: string;
  #recursive = false;
  #treesOnly = false;
  #showTrees = false;
  #nul = false;
  #long = false;
  #nameOnly = false;
  #objectOnly = false;
  #fullName = false;
  #fullTree = false;
  #abbrev?: number;
  #paths: string[] = [];

  /** The tree-ish to list (positional), e.g. `"HEAD"` or `"v1.0.0"`. */
  tree(value: string): this {
    this.#tree = value;
    return this;
  }

  /** Recurse into subtrees (`-r`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Show only trees, not blobs (`-d`). */
  treesOnly(): this {
    this.#treesOnly = true;
    return this;
  }

  /** Show the trees themselves while recursing (`-t`). */
  showTrees(): this {
    this.#showTrees = true;
    return this;
  }

  /** Terminate entries with NUL rather than newline (`-z`). */
  nulTerminated(): this {
    this.#nul = true;
    return this;
  }

  /** Include each object's size (`--long`). */
  long(): this {
    this.#long = true;
    return this;
  }

  /** List only the file names (`--name-only`). */
  nameOnly(): this {
    this.#nameOnly = true;
    return this;
  }

  /** List only the object names (`--object-only`). */
  objectOnly(): this {
    this.#objectOnly = true;
    return this;
  }

  /** Report paths from the repository root (`--full-name`). */
  fullName(): this {
    this.#fullName = true;
    return this;
  }

  /** List the whole tree, not just the current directory (`--full-tree`). */
  fullTree(): this {
    this.#fullTree = true;
    return this;
  }

  /** Abbreviate object names to this many digits (`--abbrev=<n>`). */
  abbrev(digits: number): this {
    this.#abbrev = digits;
    return this;
  }

  /** Limit the listing to these paths (positional); repeatable. */
  paths(...values: string[]): this {
    this.#paths.push(...values);
    return this;
  }

  /** Assemble the `git ls-tree` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#tree === undefined) {
      throw new Error(
        "GitTasks.lsTree: no tree given — add .tree('HEAD'), since git " +
          "ls-tree lists the contents of a named tree.",
      );
    }
    if (this.#nameOnly && this.#objectOnly) {
      throw new Error(
        "GitTasks.lsTree: .nameOnly() and .objectOnly() each reduce the " +
          "output to a different single column — pick one.",
      );
    }
    const argv = ["ls-tree"];
    if (this.#recursive) argv.push("-r");
    if (this.#treesOnly) argv.push("-d");
    if (this.#showTrees) argv.push("-t");
    if (this.#nul) argv.push("-z");
    if (this.#long) argv.push("--long");
    if (this.#nameOnly) argv.push("--name-only");
    if (this.#objectOnly) argv.push("--object-only");
    if (this.#fullName) argv.push("--full-name");
    if (this.#fullTree) argv.push("--full-tree");
    if (this.#abbrev !== undefined) argv.push(`--abbrev=${this.#abbrev}`);
    argv.push(this.#tree);
    // `--` so a path beginning with `-` is never read as a flag.
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}

/** One entry of `git ls-tree`: an object in a tree, and how it is recorded. */
export interface GitTreeEntry {
  /** The file mode, e.g. `100644` for a regular file or `040000` for a tree. */
  mode: string;
  /** The kind of object: `blob`, `tree`, or `commit` for a submodule. */
  type: string;
  /** The object name. */
  objectName: string;
  /** The path, relative to the tree that was listed. */
  path: string;
}

/**
 * Parse `git ls-tree -z` into entries. Each record is
 * `<mode> SP <type> SP <object> TAB <path>` — the tab before the path is what
 * makes the path unambiguous, since it is the only field that may contain a
 * space.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseTreeEntries(stdout: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of splitNul(stdout)) {
    const tab = record.indexOf("\t");
    // No tab means no path field: the record is not a full ls-tree entry, which
    // a --name-only or --object-only listing would produce.
    if (tab === -1) continue;
    const head = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    const [mode, type, objectName] = head;
    if (mode === undefined || type === undefined || objectName === undefined) {
      continue;
    }
    entries.push({ mode, type, objectName, path });
  }
  return entries;
}

/**
 * Run `git ls-tree -z` and parse it. Backs
 * {@link "./git.ts".GitTasks.treeEntries}.
 *
 * The single-column forms are refused rather than parsed loosely: each drops
 * fields this reader promises to return, so honouring one would hand back
 * entries whose `mode` and `type` were invented.
 */
export async function readTreeEntries(
  configure?: Configure<GitLsTreeSettings>,
): Promise<GitTreeEntry[]> {
  const settings = new GitLsTreeSettings();
  const configured = configure ? configure(settings) : settings;
  const argv = configured.argv();
  for (const flag of ["--name-only", "--object-only"]) {
    if (argv.includes(flag)) {
      throw new Error(
        `GitTasks.treeEntries: ${flag} drops the mode, type and object this ` +
          "reader reports — use GitTasks.lsTree to read that output, or drop " +
          "the flag.",
      );
    }
  }
  const output = await configured.nulTerminated().quiet().run();
  return parseTreeEntries(output.stdout);
}

/** The object attribute `git cat-file` should report instead of contents. */
export type GitCatFileQuery = "type" | "size" | "exists";

/** Settings for `git cat-file`. */
export class GitCatFileSettings extends GitSettings {
  #object?: string;
  #query?: GitCatFileQuery;
  #textconv = false;
  #filters = false;

  /** The object to read (positional), e.g. `"HEAD:deno.json"`. */
  object(value: string): this {
    this.#object = value;
    return this;
  }

  /**
   * Report an attribute rather than the contents: `type` (`-t`), `size`
   * (`-s`), or `exists` (`-e`, which answers by exit status and prints
   * nothing).
   */
  query(kind: GitCatFileQuery): this {
    this.#query = kind;
    return this;
  }

  /** Run the object through its textconv filter (`--textconv`). */
  textconv(): this {
    this.#textconv = true;
    return this;
  }

  /** Run the object through its working-tree filters (`--filters`). */
  filters(): this {
    this.#filters = true;
    return this;
  }

  /** Assemble the `git cat-file` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#object === undefined) {
      throw new Error(
        "GitTasks.catFile: no object given — add .object('HEAD:path'), since " +
          "git cat-file needs the object to read.",
      );
    }
    if (this.#textconv && this.#filters) {
      throw new Error(
        "GitTasks.catFile: .textconv() and .filters() are separate " +
          "conversions of the same content — pick one.",
      );
    }
    const argv = ["cat-file"];
    if (this.#query === "type") argv.push("-t");
    else if (this.#query === "size") argv.push("-s");
    else if (this.#query === "exists") argv.push("-e");
    else if (this.#textconv) argv.push("--textconv");
    else if (this.#filters) argv.push("--filters");
    // `-p` pretty-prints whatever the object is; without a query or a
    // conversion it is the only form that emits the contents.
    else argv.push("-p");
    argv.push(this.#object);
    return argv;
  }
}

/**
 * Run `git cat-file -p` and return the object's contents. Backs
 * {@link "./git.ts".GitTasks.blobText}.
 *
 * The output is returned as git emitted it, without trimming: a trailing
 * newline is part of a file's content, and a reader that removed it would
 * change what a build writes back out.
 */
export async function readBlobText(
  configure?: Configure<GitCatFileSettings>,
): Promise<string> {
  const settings = new GitCatFileSettings();
  const configured = configure ? configure(settings) : settings;
  const argv = configured.argv();
  for (const flag of ["-t", "-s", "-e"]) {
    if (argv.includes(flag)) {
      throw new Error(
        "GitTasks.blobText: .query() reports an attribute rather than the " +
          "contents this reader returns — drop it, or use GitTasks.catFile.",
      );
    }
  }
  const output = await configured.quiet().run();
  return output.stdout;
}
