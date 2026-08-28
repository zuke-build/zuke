// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git tag` — creating, deleting, and listing tags.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.tag((s) => s.name("v1.2.3").message("Release 1.2.3"));
 * await GitTasks.tag((s) => s.list("v1.*").sort("-v:refname"));
 * ```
 *
 * @module
 */

import { GitSettings } from "./settings.ts";

/** Settings for `git tag`. */
export class GitTagSettings extends GitSettings {
  #name?: string;
  #commit?: string;
  #message?: string;
  #force = false;
  #delete = false;
  #list?: string;
  #sort?: string;

  /** The tag name. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * The commit to tag (git's trailing `<commit>`), rather than `HEAD`. Only
   * meaningful when creating a tag.
   */
  commit(rev: string): this {
    this.#commit = rev;
    return this;
  }

  /** Create an annotated tag with this message (`-a -m`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Replace an existing tag (`-f`/`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Delete the tag (`-d`/`--delete`). */
  deleteTag(): this {
    this.#delete = true;
    return this;
  }

  /**
   * List tags (`-l`), optionally matching a shell pattern such as `v1.*`.
   * With no pattern, lists them all.
   */
  list(pattern?: string): this {
    this.#list = pattern ?? "";
    return this;
  }

  /**
   * Order a listing (`--sort=<key>`), e.g. `-v:refname` for newest-version
   * first — the ordering a release target wants, since the default is
   * lexicographic and puts `v1.10.0` before `v1.9.0`.
   */
  sort(key: string): this {
    this.#sort = key;
    return this;
  }

  /** Assemble the `git tag` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["tag"];
    if (this.#delete) argv.push("--delete");
    if (this.#force) argv.push("--force");
    if (this.#sort !== undefined) argv.push(`--sort=${this.#sort}`);
    if (this.#list !== undefined) {
      if (
        this.#name !== undefined || this.#message !== undefined || this.#delete
      ) {
        throw new Error(
          "GitTasks.tag: .list() lists tags — it cannot also create or delete " +
            "one. Drop .name(...)/.message(...)/.deleteTag(), or drop .list().",
        );
      }
      argv.push("--list");
      if (this.#list !== "") argv.push(this.#list);
      return argv;
    }
    if (this.#message !== undefined) argv.push("-a", "-m", this.#message);
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#commit !== undefined) argv.push(this.#commit);
    return argv;
  }
}
