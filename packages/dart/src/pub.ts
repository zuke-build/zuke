// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `dart pub` subcommands.
 *
 * @module
 */

import { nameOperand } from "./operand.ts";
import { DartSettings } from "./settings.ts";

/** Settings for `dart pub get`. */
export class DartPubGetSettings extends DartSettings {
  #flags: string[] = [];

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /** Resolve from the local pub cache only (`--offline`). */
  offline(): this {
    return this.#push("--offline");
  }

  /** Fail rather than change `pubspec.lock` (`--enforce-lockfile`). */
  enforceLockfile(): this {
    return this.#push("--enforce-lockfile");
  }

  /** Report what would change without changing it (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Skip precompiling executables (`--no-precompile`). */
  noPrecompile(): this {
    return this.#push("--no-precompile");
  }

  /** Assemble the `dart pub get` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "get", ...this.#flags];
  }
}

/** Settings for `dart pub upgrade`. */
export class DartPubUpgradeSettings extends DartSettings {
  #packages: string[] = [];
  #flags: string[] = [];

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /** Upgrade only this package (defaults to all); repeatable. */
  package(name: string): this {
    this.#packages.push(nameOperand("pubUpgrade", name));
    return this;
  }

  /** Resolve from the local pub cache only (`--offline`). */
  offline(): this {
    return this.#push("--offline");
  }

  /** Report what would change without changing it (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Also raise constraints in `pubspec.yaml` across majors (`--major-versions`). */
  majorVersions(): this {
    return this.#push("--major-versions");
  }

  /** Raise lower bounds in `pubspec.yaml` to the resolved versions (`--tighten`). */
  tighten(): this {
    return this.#push("--tighten");
  }

  /** Also upgrade the transitive dependencies of the named packages (`--unlock-transitive`). */
  unlockTransitive(): this {
    return this.#push("--unlock-transitive");
  }

  /** Assemble the `dart pub upgrade` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "upgrade", ...this.#flags, ...this.#packages];
  }
}

/** Settings for `dart pub downgrade`. */
export class DartPubDowngradeSettings extends DartSettings {
  #packages: string[] = [];
  #flags: string[] = [];

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /** Downgrade only this package (defaults to all); repeatable. */
  package(name: string): this {
    this.#packages.push(nameOperand("pubDowngrade", name));
    return this;
  }

  /** Resolve from the local pub cache only (`--offline`). */
  offline(): this {
    return this.#push("--offline");
  }

  /** Report what would change without changing it (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Lower the constraints in `pubspec.yaml` to the resolved versions (`--tighten`). */
  tighten(): this {
    return this.#push("--tighten");
  }

  /** Assemble the `dart pub downgrade` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "downgrade", ...this.#flags, ...this.#packages];
  }
}

/** Settings for `dart pub outdated`. */
export class DartPubOutdatedSettings extends DartSettings {
  #flags: string[] = [];

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /** Print machine-readable JSON (`--json`). */
  json(): this {
    return this.#push("--json");
  }

  /** Include packages that are already up to date (`--show-all`). */
  showAll(): this {
    return this.#push("--show-all");
  }

  /** Leave dev dependencies out (`--no-dev-dependencies`). */
  noDevDependencies(): this {
    return this.#push("--no-dev-dependencies");
  }

  /** Leave transitive dependencies out (`--no-transitive`). */
  noTransitive(): this {
    return this.#push("--no-transitive");
  }

  /** Include prereleases when looking for newer versions (`--prereleases`). */
  prereleases(): this {
    return this.#push("--prereleases");
  }

  /** Assemble the `dart pub outdated` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "outdated", ...this.#flags];
  }
}

/** Settings for `dart pub deps`. */
export class DartPubDepsSettings extends DartSettings {
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The layout: `compact`, `tree` (default) or `list` (`--style`). */
  style(name: "compact" | "tree" | "list"): this {
    return this.#push("--style", name);
  }

  /** Leave dev dependencies out (`--no-dev`). */
  noDev(): this {
    return this.#push("--no-dev");
  }

  /** List the executables the dependencies expose instead (`--executables`). */
  executables(): this {
    return this.#push("--executables");
  }

  /** Print the dependency graph as JSON (`--json`). */
  json(): this {
    return this.#push("--json");
  }

  /** Assemble the `dart pub deps` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "deps", ...this.#flags];
  }
}

/** Settings for `dart pub add` and `dart pub remove`. */
export class DartPubPackagesSettings extends DartSettings {
  readonly #verb: "add" | "remove";
  #packages: string[] = [];
  #flags: string[] = [];

  /** Settings for `dart pub <verb>`. */
  constructor(verb: "add" | "remove") {
    super();
    this.#verb = verb;
  }

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /**
   * A package to add or remove; repeatable, at least one is required. For
   * `add` it takes pub's descriptor syntax: `http`, `http:^1.2.0`, or
   * `dev:mocktail` for a dev dependency.
   */
  package(spec: string): this {
    this.#packages.push(nameOperand(this.#task(), spec));
    return this;
  }

  /** Resolve from the local pub cache only (`--offline`). */
  offline(): this {
    return this.#push("--offline");
  }

  /** Report what would change without changing it (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  #task(): string {
    return this.#verb === "add" ? "pubAdd" : "pubRemove";
  }

  /** Assemble the `dart pub add|remove` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        `DartTasks.${this.#task()}: at least one .package() is required.`,
      );
    }
    return ["pub", this.#verb, ...this.#flags, ...this.#packages];
  }
}

/** Settings for `dart pub publish`. */
export class DartPubPublishSettings extends DartSettings {
  #flags: string[] = [];

  #push(flag: string): this {
    this.#flags.push(flag);
    return this;
  }

  /** Validate the package without uploading it (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Publish without the confirmation prompt — what CI needs (`--force`). */
  force(): this {
    return this.#push("--force");
  }

  /** Publish even when validation reports warnings (`--skip-validation`). */
  skipValidation(): this {
    return this.#push("--skip-validation");
  }

  /** Assemble the `dart pub publish` argv. */
  protected override buildArgs(): string[] {
    return ["pub", "publish", ...this.#flags];
  }
}
