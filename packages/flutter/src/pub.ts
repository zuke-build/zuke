// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `flutter pub` subcommands.
 *
 * @module
 */

import { nameOperand } from "./operand.ts";
import { FlutterSettings } from "./settings.ts";

/** Settings for `flutter pub get`. */
export class FlutterPubGetSettings extends FlutterSettings {
  #offline = false;
  #enforceLockfile = false;

  /** Resolve from the local pub cache only (`--offline`). */
  offline(): this {
    this.#offline = true;
    return this;
  }

  /** Fail rather than change `pubspec.lock` (`--enforce-lockfile`). */
  enforceLockfile(): this {
    this.#enforceLockfile = true;
    return this;
  }

  /** Assemble the `flutter pub get` argv. */
  protected override buildArgs(): string[] {
    const argv = ["pub", "get"];
    if (this.#offline) argv.push("--offline");
    if (this.#enforceLockfile) argv.push("--enforce-lockfile");
    return argv;
  }
}

/** Settings for `flutter pub upgrade`. */
export class FlutterPubUpgradeSettings extends FlutterSettings {
  #packages: string[] = [];
  #majorVersions = false;
  #tighten = false;

  /** Upgrade only this package (defaults to all); repeatable. */
  package(name: string): this {
    this.#packages.push(nameOperand("pubUpgrade", name));
    return this;
  }

  /** Also raise constraints in `pubspec.yaml` across majors (`--major-versions`). */
  majorVersions(): this {
    this.#majorVersions = true;
    return this;
  }

  /** Raise lower bounds in `pubspec.yaml` to the resolved versions (`--tighten`). */
  tighten(): this {
    this.#tighten = true;
    return this;
  }

  /** Assemble the `flutter pub upgrade` argv. */
  protected override buildArgs(): string[] {
    const argv = ["pub", "upgrade"];
    if (this.#majorVersions) argv.push("--major-versions");
    if (this.#tighten) argv.push("--tighten");
    return [...argv, ...this.#packages];
  }
}

/** Settings for `flutter pub outdated`. */
export class FlutterPubOutdatedSettings extends FlutterSettings {
  #json = false;
  #showAll = false;

  /** Print machine-readable JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Include packages that are already up to date (`--show-all`). */
  showAll(): this {
    this.#showAll = true;
    return this;
  }

  /** Assemble the `flutter pub outdated` argv. */
  protected override buildArgs(): string[] {
    const argv = ["pub", "outdated"];
    if (this.#json) argv.push("--json");
    if (this.#showAll) argv.push("--show-all");
    return argv;
  }
}

/** Settings for `flutter pub deps`. */
export class FlutterPubDepsSettings extends FlutterSettings {
  #json = false;

  /** Print the dependency graph as JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Assemble the `flutter pub deps` argv. */
  protected override buildArgs(): string[] {
    return this.#json ? ["pub", "deps", "--json"] : ["pub", "deps"];
  }
}

/** Settings for `flutter pub add` and `flutter pub remove`. */
export class FlutterPubPackagesSettings extends FlutterSettings {
  readonly #verb: "add" | "remove";
  #packages: string[] = [];

  /** Settings for `flutter pub <verb>`. */
  constructor(verb: "add" | "remove") {
    super();
    this.#verb = verb;
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

  #task(): string {
    return this.#verb === "add" ? "pubAdd" : "pubRemove";
  }

  /** Assemble the `flutter pub add|remove` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        `FlutterTasks.${this.#task()}: at least one .package() is required.`,
      );
    }
    return ["pub", this.#verb, ...this.#packages];
  }
}
