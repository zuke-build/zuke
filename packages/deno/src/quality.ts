// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that inspect sources without running
 * them: `check`, `fmt`, `lint` and `doc`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoSettings } from "./settings.ts";

/** Settings for `deno check`. */
export class DenoCheckSettings extends DenoSettings {
  #paths: string[] = [];
  #frozen = false;
  #config?: string;
  #noLock = false;

  /** The files to type-check (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /**
   * Type-check against a specific configuration file (`--config`) instead of the
   * one Deno would discover by walking up from the checked files.
   *
   * The discovered config decides how bare specifiers resolve, so pointing at
   * another one type-checks the same sources against a different dependency
   * set — for example checking a workspace member against the *published*
   * version of a sibling it declares, rather than the local member that
   * workspace resolution would substitute.
   */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /**
   * Ignore the lockfile entirely (`--no-lock`), neither reading nor writing it.
   *
   * Use it for a check whose resolutions are deliberately not the project's:
   * writing them into the committed lock would corrupt it, and reading it would
   * pin the very versions the check is trying to vary.
   */
  noLock(): this {
    this.#noLock = true;
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** Assemble the `deno check` argv. */
  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.check: at least one path is required (use .paths()).",
      );
    }
    const argv = ["check"];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#noLock) argv.push("--no-lock");
    if (this.#frozen) argv.push("--frozen");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno fmt`. */
export class DenoFmtSettings extends DenoSettings {
  #check = false;
  #paths: string[] = [];

  /** Verify formatting without writing changes (`--check`). */
  check(): this {
    this.#check = true;
    return this;
  }

  /** Restrict formatting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Assemble the `deno fmt` argv. */
  protected override buildArgs(): string[] {
    const argv = ["fmt"];
    if (this.#check) argv.push("--check");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno lint`. */
export class DenoLintSettings extends DenoSettings {
  #fix = false;
  #paths: string[] = [];

  /** Apply automatic fixes (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Restrict linting to specific files or directories. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Assemble the `deno lint` argv. */
  protected override buildArgs(): string[] {
    const argv = ["lint"];
    if (this.#fix) argv.push("--fix");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno doc`. */
export class DenoDocSettings extends DenoSettings {
  #paths: string[] = [];
  #flags: string[] = [];

  /** The source files (entry points) to document. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Output the documentation as JSON (`--json`). */
  json(): this {
    this.#flags.push("--json");
    return this;
  }

  /**
   * Error out if the lockfile is out of date (`--frozen`). See
   * {@link DenoPermissionSettings.frozen} for why the name mirrors the real
   * Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
   */
  frozen(): this {
    this.#flags.push("--frozen");
    return this;
  }

  /** Generate static HTML documentation (`--html`). */
  html(): this {
    this.#flags.push("--html");
    return this;
  }

  /** Title for the generated HTML documentation (`--name`). */
  name(title: string): this {
    this.#flags.push("--name", title);
    return this;
  }

  /** Output directory for HTML documentation (`--output`). */
  output(dir: PathLike): this {
    this.#flags.push("--output", String(dir));
    return this;
  }

  /** Include private and internal symbols (`--private`). */
  private(): this {
    this.#flags.push("--private");
    return this;
  }

  /** Document only the symbol at this dot-separated path (`--filter`). */
  filter(symbol: string): this {
    this.#flags.push("--filter", symbol);
    return this;
  }

  /** Report documentation diagnostics rather than rendering docs (`--lint`). */
  lint(): this {
    this.#flags.push("--lint");
    return this;
  }

  /** Assemble the `deno doc` argv. */
  protected override buildArgs(): string[] {
    return ["doc", ...this.#flags, ...this.#paths];
  }
}
