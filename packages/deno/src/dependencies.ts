// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `deno` subcommands that manage a project's dependencies and
 * the artifacts built from them: `cache`, `install` and `publish`.
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoPermissionSettings, DenoSettings } from "./settings.ts";

/** Settings for `deno cache`. */
export class DenoCacheSettings extends DenoSettings {
  #reload = false;
  #frozen = false;
  #paths: string[] = [];

  /** Reload remote modules instead of using the cache (`--reload`). */
  reload(): this {
    this.#reload = true;
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

  /** The entry points to cache (at least one is required). */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Assemble the `deno cache` argv. */
  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "DenoTasks.cache: at least one path is required (use .paths()).",
      );
    }
    const argv = ["cache"];
    if (this.#frozen) argv.push("--frozen");
    if (this.#reload) argv.push("--reload");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `deno install`. */
export class DenoInstallSettings extends DenoPermissionSettings {
  #global = false;
  #force = false;
  #root?: string;
  #name?: string;
  #module?: string;
  #moduleArgs: string[] = [];

  /** Install a global executable (`--global`/`-g`) instead of project deps. */
  global(): this {
    this.#global = true;
    return this;
  }

  /** Overwrite an existing installation (`--force`/`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Install root; the binary lands in `<root>/bin` (`--root`). */
  root(path: PathLike): this {
    this.#root = String(path);
    return this;
  }

  /** Name the installed executable (`--name`/`-n`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The module to install, e.g. `npm:cspell@9` (required for a global install). */
  module(spec: string): this {
    this.#module = spec;
    return this;
  }

  /** Arguments baked into the generated launcher (after the module). */
  moduleArgs(...args: Array<string | number>): this {
    this.#moduleArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `deno install` argv. */
  protected override buildArgs(): string[] {
    const argv = ["install", ...this.permissionArgs, ...this.frozenArgs];
    if (this.#global) argv.push("--global");
    if (this.#force) argv.push("--force");
    if (this.#root !== undefined) argv.push("--root", this.#root);
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#module !== undefined) argv.push(this.#module);
    argv.push(...this.#moduleArgs);
    return argv;
  }
}

/** Settings for `deno publish`. */
export class DenoPublishSettings extends DenoSettings {
  #allowDirty = false;
  #allowSlowTypes = false;
  #noCheck = false;
  #dryRun = false;
  #config?: string;
  #token?: string;

  /** Publish even with an uncommitted working tree (`--allow-dirty`). */
  allowDirty(): this {
    this.#allowDirty = true;
    return this;
  }

  /** Permit slow types in the published package (`--allow-slow-types`). */
  allowSlowTypes(): this {
    this.#allowSlowTypes = true;
    return this;
  }

  /** Skip type-checking before publishing (`--no-check`). */
  noCheck(): this {
    this.#noCheck = true;
    return this;
  }

  /** Validate without publishing (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Authenticate with a token instead of interactive/OIDC auth (`--token`). */
  token(value: string): this {
    this.#token = value;
    return this;
  }

  /** Assemble the `deno publish` argv. */
  protected override buildArgs(): string[] {
    const argv = ["publish"];
    if (this.#allowDirty) argv.push("--allow-dirty");
    if (this.#allowSlowTypes) argv.push("--allow-slow-types");
    if (this.#noCheck) argv.push("--no-check");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#token !== undefined) argv.push("--token", this.#token);
    return argv;
  }
}
