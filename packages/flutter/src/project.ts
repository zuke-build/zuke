// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the project commands: `flutter create`, and the flagless
 * `flutter clean` and `flutter gen-l10n`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { FlutterSettings } from "./settings.ts";

/** A `flutter` command that a build runs without flags. */
export type FlutterPlainCommand = "clean" | "gen-l10n";

/**
 * Settings for a flagless command: `flutter clean`, or `flutter gen-l10n`
 * (configured by `l10n.yaml`). Extra flags go through `.args()`.
 */
export class FlutterCommandSettings extends FlutterSettings {
  readonly #command: FlutterPlainCommand;

  /** Settings for `flutter <command>`. */
  constructor(command: FlutterPlainCommand) {
    super();
    this.#command = command;
  }

  /** Assemble the `flutter <command>` argv. */
  protected override buildArgs(): string[] {
    return [this.#command];
  }
}

/** Settings for `flutter create`. */
export class FlutterCreateSettings extends FlutterSettings {
  #dir?: string;
  #flags: string[] = [];
  #platforms: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The directory to create the project in; required. */
  dir(path: PathLike): this {
    this.#dir = pathOperand(path);
    return this;
  }

  /** The reverse-domain organization, e.g. `com.example` (`--org`). */
  org(org: string): this {
    return this.#push("--org", org);
  }

  /** The Dart package name, instead of the directory's (`--project-name`). */
  projectName(name: string): this {
    return this.#push("--project-name", name);
  }

  /** The project description (`--description`). */
  description(text: string): this {
    return this.#push("--description", text);
  }

  /** The template: `app`, `module`, `package`, `plugin`, … (`--template`). */
  template(name: string): this {
    return this.#push("--template", name);
  }

  /** A platform to scaffold, e.g. `android` or `web` (`--platforms`); repeatable. */
  platform(name: string): this {
    this.#platforms.push(name);
    return this;
  }

  /** Scaffold a minimal app without the counter sample (`--empty`). */
  empty(): this {
    return this.#push("--empty");
  }

  /** Assemble the `flutter create` argv. */
  protected override buildArgs(): string[] {
    if (this.#dir === undefined) {
      throw new Error("FlutterTasks.create: .dir() is required.");
    }
    const argv = ["create", ...this.#flags];
    if (this.#platforms.length > 0) {
      argv.push("--platforms", this.#platforms.join(","));
    }
    return [...argv, this.#dir];
  }
}
