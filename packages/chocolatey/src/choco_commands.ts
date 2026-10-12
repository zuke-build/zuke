// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The typed `choco` commands for building, publishing and installing
 * packages: `pack`, `push`, `install`, `uninstall` and `apikey`. Each setter
 * is named after the option it renders, so the settings read like choco's own
 * help.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { ChocoCommandSettings, optionIf } from "./choco_settings.ts";

/** Refuse a run with no operand, for a command that needs at least one. */
function requireOperand(
  operands: readonly string[],
  verb: string,
  setter: string,
): void {
  if (operands.length === 0) {
    throw new Error(`choco ${verb} requires .${setter}(...).`);
  }
}

/**
 * Settings for `choco pack`, which builds a `.nupkg` from a `.nuspec`. With no
 * nuspec named, choco packs the one in the working directory.
 */
export class ChocoPackSettings extends ChocoCommandSettings {
  #version?: string;
  #outputDirectory?: string;

  /** The `.nuspec` to pack; defaults to the one in the working directory. */
  nuspec(path: PathLike): this {
    this.addOperands([String(path)]);
    return this;
  }

  /** The version to write into the package, overriding the nuspec's (`--version`). */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** Where to write the `.nupkg` (`--output-directory`); defaults to the working directory. */
  outputDirectory(path: PathLike): this {
    this.#outputDirectory = String(path);
    return this;
  }

  /** The command: `pack`. */
  protected verb(): string[] {
    return ["pack"];
  }

  /** The options set, in choco's help order. */
  protected commandFlags(): string[] {
    const argv: string[] = [];
    optionIf(argv, "version", this.#version);
    optionIf(argv, "output-directory", this.#outputDirectory);
    return argv;
  }
}

/**
 * Settings for `choco push`, which uploads a `.nupkg` to a source. With no
 * package named, choco pushes the only `.nupkg` in the working directory.
 *
 * The API key is an argument — choco reads it from nowhere else — so it is
 * registered with the run's redactor and masked out of any error the push
 * raises. It is still visible in the process table for the push's duration;
 * on a shared host, save it once with `choco apikey add` instead and leave
 * {@link apiKey} unset, and choco looks it up by source.
 */
export class ChocoPushSettings extends ChocoCommandSettings {
  #source?: string;
  #apiKey?: string;

  /** The `.nupkg` to push. */
  nupkg(path: PathLike): this {
    this.addOperands([String(path)]);
    return this;
  }

  /**
   * The source to push to (`--source`), e.g. `https://push.chocolatey.org/`
   * for the community repository.
   */
  source(url: string): this {
    this.#source = url;
    return this;
  }

  /**
   * The source's API key (`--api-key`). Masked in every rendering of the
   * command and in its errors.
   */
  apiKey(value: string): this {
    this.#apiKey = value;
    this.secret(value);
    return this;
  }

  /** The command: `push`. */
  protected verb(): string[] {
    return ["push"];
  }

  /** The options set, in choco's help order. */
  protected commandFlags(): string[] {
    const argv: string[] = [];
    optionIf(argv, "source", this.#source);
    optionIf(argv, "api-key", this.#apiKey);
    return argv;
  }
}

/** Settings for `choco install`. */
export class ChocoInstallSettings extends ChocoCommandSettings {
  #source?: string;
  #version?: string;
  #prerelease = false;

  /** Package ids to install (required); repeatable. */
  packages(...ids: string[]): this {
    this.addOperands(ids);
    return this;
  }

  /**
   * Where to find the packages (`--source`): a feed URL, or a local directory
   * holding `.nupkg` files. Defaults to the configured feeds.
   */
  source(location: string): this {
    this.#source = location;
    return this;
  }

  /** The exact version to install (`--version`). */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** Consider prerelease versions (`--prerelease`). */
  prerelease(): this {
    this.#prerelease = true;
    return this;
  }

  /** The command: `install`. */
  protected verb(): string[] {
    return ["install"];
  }

  /** The options set, in choco's help order. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "install", "packages");
    const argv: string[] = [];
    optionIf(argv, "source", this.#source);
    optionIf(argv, "version", this.#version);
    if (this.#prerelease) argv.push("--prerelease");
    return argv;
  }
}

/** Settings for `choco uninstall`. */
export class ChocoUninstallSettings extends ChocoCommandSettings {
  #source?: string;
  #version?: string;
  #allVersions = false;

  /** Package ids to uninstall (required); repeatable. */
  packages(...ids: string[]): this {
    this.addOperands(ids);
    return this;
  }

  /** The source the packages came from (`--source`). */
  source(location: string): this {
    this.#source = location;
    return this;
  }

  /** The installed version to uninstall (`--version`). */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** Uninstall every installed version (`--all-versions`). */
  allVersions(): this {
    this.#allVersions = true;
    return this;
  }

  /** The command: `uninstall`. */
  protected verb(): string[] {
    return ["uninstall"];
  }

  /** The options set, in choco's help order. */
  protected commandFlags(): string[] {
    requireOperand(this.operands, "uninstall", "packages");
    const argv: string[] = [];
    optionIf(argv, "source", this.#source);
    optionIf(argv, "version", this.#version);
    if (this.#allVersions) argv.push("--all-versions");
    return argv;
  }
}

/** What `choco apikey` does: list the saved keys, save one, or remove one. */
export type ChocoApikeyAction = "list" | "add" | "remove";

/**
 * Settings for `choco apikey`, which manages the API keys choco saves per
 * source — so a later `choco push` to that source needs no key on its
 * command line.
 *
 * ```ts
 * await ChocoTasks.apikey((s) =>
 *   s.add().source("https://push.chocolatey.org/").apiKey(key)
 * );
 * ```
 *
 * `add` needs a {@link source} and an {@link apiKey}; `remove` needs a
 * source. With no action set, choco lists the saved keys (by source; it never
 * prints a key itself).
 */
export class ChocoApikeySettings extends ChocoCommandSettings {
  #action?: ChocoApikeyAction;
  #source?: string;
  #apiKey?: string;

  /** List the saved keys' sources (`apikey list`). */
  list(): this {
    this.#action = "list";
    return this;
  }

  /** Save the {@link apiKey} for the {@link source} (`apikey add`). */
  add(): this {
    this.#action = "add";
    return this;
  }

  /** Remove the key saved for the {@link source} (`apikey remove`). */
  remove(): this {
    this.#action = "remove";
    return this;
  }

  /** The source the key is for (`--source`). */
  source(url: string): this {
    this.#source = url;
    return this;
  }

  /**
   * The key to save (`--api-key`), for {@link add}. Masked in every rendering
   * of the command and in its errors.
   */
  apiKey(value: string): this {
    this.#apiKey = value;
    this.secret(value);
    return this;
  }

  /** The command: `apikey`, then the action when one is set. */
  protected verb(): string[] {
    return this.#action === undefined ? ["apikey"] : ["apikey", this.#action];
  }

  /**
   * The options set.
   *
   * @throws {Error} when `add` lacks a source or key, `remove` lacks a
   *   source, or a key is given to anything but `add`.
   */
  protected commandFlags(): string[] {
    const action = this.#action ?? "list";
    if (action !== "list" && this.#source === undefined) {
      throw new Error(`choco apikey ${action} requires .source(...).`);
    }
    if (action === "add" && this.#apiKey === undefined) {
      throw new Error("choco apikey add requires .apiKey(...).");
    }
    if (action !== "add" && this.#apiKey !== undefined) {
      throw new Error(
        `choco apikey ${action} takes no .apiKey(...); only add saves one.`,
      );
    }
    const argv: string[] = [];
    optionIf(argv, "source", this.#source);
    optionIf(argv, "api-key", this.#apiKey);
    return argv;
  }
}
