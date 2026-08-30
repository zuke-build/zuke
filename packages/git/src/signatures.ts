// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git verify-commit` and `git verify-tag` — checking the GPG signature on the
 * objects a release is cut from.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * if (!await GitTasks.isSignatureValid((s) => s.objects("v1.0.0"))) {
 *   throw new Error("the release tag is not signed by a trusted key");
 * }
 * ```
 *
 * Both commands answer by exit status, so
 * {@link "./git.ts".GitTasks.isSignatureValid} reads it back as a boolean.
 * What that status can and cannot tell the caller apart is stated exactly on
 * {@link readIsSignatureValid} — it is less than it looks.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/**
 * The flags both verification commands share, held as a field rather than a
 * base class: an exported class extending an unexported one is a
 * `private-type-ref` in `deno doc --lint`, and exporting the base would widen
 * the public surface for no caller's benefit.
 */
class VerifyFlags {
  #verbose = false;
  #raw = false;
  #objects: string[] = [];

  /** Also print the object's contents (`-v`). */
  setVerbose(): void {
    this.#verbose = true;
  }

  /** Print gpg's raw status output (`--raw`). */
  setRaw(): void {
    this.#raw = true;
  }

  /** Add objects to verify. */
  addObjects(values: readonly string[]): void {
    this.#objects.push(...values);
  }

  /** Whether any object was named. */
  get hasObjects(): boolean {
    return this.#objects.length > 0;
  }

  /** The flags, in git's order, followed by the objects. */
  render(): string[] {
    const argv: string[] = [];
    if (this.#verbose) argv.push("-v");
    if (this.#raw) argv.push("--raw");
    return argv;
  }

  /** The objects, which must come last. */
  renderObjects(): string[] {
    return [...this.#objects];
  }
}

/** The refusal both commands raise when given nothing to verify. */
function requireObjects(
  flags: VerifyFlags,
  task: string,
  subcommand: string,
): void {
  if (!flags.hasObjects) {
    throw new Error(
      `GitTasks.${task}: no objects given — add .objects('v1.0.0'), since ` +
        `git ${subcommand} needs something to verify.`,
    );
  }
}

/** Settings for `git verify-commit`. */
export class GitVerifyCommitSettings extends GitSettings {
  #flags = new VerifyFlags();

  /** Also print the commit's contents (`-v`). */
  verbose(): this {
    this.#flags.setVerbose();
    return this;
  }

  /** Print gpg's raw status output (`--raw`). */
  raw(): this {
    this.#flags.setRaw();
    return this;
  }

  /** The commits to verify (positional); repeatable. */
  objects(...values: string[]): this {
    this.#flags.addObjects(values);
    return this;
  }

  /** Assemble the `git verify-commit` argv. */
  protected override subcommandArgs(): string[] {
    requireObjects(this.#flags, "verifyCommit", "verify-commit");
    return [
      "verify-commit",
      ...this.#flags.render(),
      ...this.#flags.renderObjects(),
    ];
  }
}

/** Settings for `git verify-tag`. */
export class GitVerifyTagSettings extends GitSettings {
  #flags = new VerifyFlags();
  #format?: string;

  /** Also print the tag's contents (`-v`). */
  verbose(): this {
    this.#flags.setVerbose();
    return this;
  }

  /** Print gpg's raw status output (`--raw`). */
  raw(): this {
    this.#flags.setRaw();
    return this;
  }

  /**
   * The output format (`--format=<format>`), in git's placeholder language.
   * `verify-tag` accepts this where `verify-commit` does not.
   */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** The tags to verify (positional); repeatable. */
  objects(...values: string[]): this {
    this.#flags.addObjects(values);
    return this;
  }

  /** Assemble the `git verify-tag` argv. */
  protected override subcommandArgs(): string[] {
    requireObjects(this.#flags, "verifyTag", "verify-tag");
    const argv = ["verify-tag", ...this.#flags.render()];
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    argv.push(...this.#flags.renderObjects());
    return argv;
  }
}

/**
 * Read a verification command's exit status as a boolean.
 *
 * Git spends only two statuses here, and the split is not where it looks: `0`
 * is a good signature, and `1` is *everything else* — a bad signature, an
 * object carrying no signature at all, and an object that does not exist. All
 * three were confirmed against git 2.43.0, including the last, which exits `1`
 * rather than the `128` the other interrogation commands use for a bad ref.
 *
 * So this reader answers the question it can answer — "is this object's
 * signature good?" — and a caller who needs to tell an unsigned tag from a
 * missing one must establish the object exists separately, with
 * {@link "./git.ts".GitTasks.showRef} or
 * {@link "./git.ts".GitTasks.catFile}. Inferring it from git's stderr text
 * would be guessing at a message that is not part of any interface.
 */
async function readSignatureValid(settings: GitSettings): Promise<boolean> {
  const output = await settings.quiet().noThrow().run();
  return output.code === 0;
}

/**
 * Verify a commit's signature and return whether it is good. Backs
 * {@link "./git.ts".GitTasks.isSignatureValid}; see
 * {@link readSignatureValid} for what a `false` does and does not mean.
 */
export function readIsSignatureValid(
  configure?: Configure<GitVerifyCommitSettings>,
): Promise<boolean> {
  const settings = new GitVerifyCommitSettings();
  return readSignatureValid(configure ? configure(settings) : settings);
}

/**
 * Verify a tag's signature and return whether it is good. Backs
 * {@link "./git.ts".GitTasks.isTagSignatureValid}; see
 * {@link readSignatureValid} for what a `false` does and does not mean.
 */
export function readIsTagSignatureValid(
  configure?: Configure<GitVerifyTagSettings>,
): Promise<boolean> {
  const settings = new GitVerifyTagSettings();
  return readSignatureValid(configure ? configure(settings) : settings);
}
