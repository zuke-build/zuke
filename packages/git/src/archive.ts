// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git archive` — packaging a tree as a tarball or zip, from git's own record
 * of what is tracked rather than from whatever the working directory holds.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.archive((s) =>
 *   s.format("tar.gz").prefix("app-1.2.3/").output("dist/app-1.2.3.tar.gz")
 *     .treeish("v1.2.3")
 * );
 * ```
 *
 * A release artifact built this way carries no build output, no `node_modules`,
 * and nothing else untracked — which is exactly why it is `git archive` and
 * not a `tar` of the directory.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git archive`. */
export class GitArchiveSettings extends GitSettings {
  #treeish?: string;
  #format?: string;
  #output?: string;
  #prefix?: string;
  #remote?: string;
  #paths: string[] = [];

  /** The tree, commit, or tag to archive (positional, required). */
  treeish(rev: string): this {
    this.#treeish = rev;
    return this;
  }

  /** The archive format (`--format=<fmt>`), e.g. `tar`, `tar.gz`, or `zip`. */
  format(name: string): this {
    this.#format = name;
    return this;
  }

  /** Write to this file (`--output=<file>`) instead of stdout. */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Prepend this path to every entry (`--prefix=<prefix>/`). */
  prefix(value: string): this {
    this.#prefix = value;
    return this;
  }

  /** Ask a remote repository for the archive (`--remote=<repo>`). */
  remote(nameOrUrl: string): this {
    this.#remote = nameOrUrl;
    return this;
  }

  /** Archive only these pathspecs (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Assemble the `git archive` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#treeish === undefined) {
      throw new Error(
        "GitTasks.archive: .treeish(...) is required — it names what to " +
          "archive, e.g. HEAD or a tag.",
      );
    }
    const argv = ["archive"];
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    if (this.#prefix !== undefined) argv.push(`--prefix=${this.#prefix}`);
    if (this.#output !== undefined) argv.push(`--output=${this.#output}`);
    if (this.#remote !== undefined) argv.push(`--remote=${this.#remote}`);
    argv.push(this.#treeish);
    if (this.#paths.length > 0) argv.push("--", ...this.#paths);
    return argv;
  }
}
