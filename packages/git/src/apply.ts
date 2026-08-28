// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git apply` — applying a patch file to the working tree or index.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * // Would this patch apply cleanly? `--check` changes nothing either way.
 * await GitTasks.apply((s) => s.check().patches("fix.patch"));
 * await GitTasks.apply((s) => s.index().threeWay().patches("fix.patch"));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Settings for `git apply`. */
export class GitApplySettings extends GitSettings {
  #patches: string[] = [];
  #check = false;
  #reverse = false;
  #threeWay = false;
  #index = false;
  #cached = false;
  #strip?: number;
  #whitespace?: string;
  #excludes: string[] = [];

  /** The patch files to apply (positional); repeatable. Reads stdin when empty. */
  patches(...values: PathLike[]): this {
    this.#patches.push(...values.map(String));
    return this;
  }

  /** Report whether the patch would apply, changing nothing (`--check`). */
  check(): this {
    this.#check = true;
    return this;
  }

  /** Apply the patch backwards (`--reverse`). */
  reverse(): this {
    this.#reverse = true;
    return this;
  }

  /**
   * Fall back to a three-way merge when the patch does not apply cleanly
   * (`--3way`), leaving conflict markers instead of refusing outright.
   */
  threeWay(): this {
    this.#threeWay = true;
    return this;
  }

  /** Apply to the index as well as the working tree (`--index`). */
  index(): this {
    this.#index = true;
    return this;
  }

  /** Apply to the index only, leaving the working tree alone (`--cached`). */
  cached(): this {
    this.#cached = true;
    return this;
  }

  /** Strip this many leading path components (`-p<n>`); git's default is 1. */
  strip(components: number): this {
    this.#strip = components;
    return this;
  }

  /**
   * What to do about whitespace errors (`--whitespace=<action>`): `nowarn`,
   * `warn`, `fix`, `error`, or `error-all`.
   */
  whitespace(action: "nowarn" | "warn" | "fix" | "error" | "error-all"): this {
    this.#whitespace = action;
    return this;
  }

  /** Skip files matching this pattern (`--exclude=<pattern>`); repeatable. */
  exclude(...patterns: string[]): this {
    this.#excludes.push(...patterns);
    return this;
  }

  /** Assemble the `git apply` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#index && this.#cached) {
      throw new Error(
        "GitTasks.apply: .index() applies to the index and the working tree, " +
          ".cached() to the index alone — pick one.",
      );
    }
    const argv = ["apply"];
    if (this.#check) argv.push("--check");
    if (this.#reverse) argv.push("--reverse");
    if (this.#threeWay) argv.push("--3way");
    if (this.#index) argv.push("--index");
    if (this.#cached) argv.push("--cached");
    if (this.#strip !== undefined) argv.push(`-p${this.#strip}`);
    if (this.#whitespace !== undefined) {
      argv.push(`--whitespace=${this.#whitespace}`);
    }
    for (const pattern of this.#excludes) argv.push(`--exclude=${pattern}`);
    argv.push(...this.#patches);
    return argv;
  }
}
