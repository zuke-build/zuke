// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the project commands: `dart create`, `dart doc`, `dart fix`,
 * `dart info` and `dart --version`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { DartSettings } from "./settings.ts";

/** A `dart create` template (`--template`). */
export type DartCreateTemplate =
  | "cli"
  | "console"
  | "package"
  | "server-shelf"
  | "web";

/** Settings for `dart create`. */
export class DartCreateSettings extends DartSettings {
  #dir?: string;
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The directory to create the project in; required. */
  dir(path: PathLike): this {
    this.#dir = pathOperand(path);
    return this;
  }

  /** The project template, instead of `console` (`--template`). */
  template(name: DartCreateTemplate): this {
    return this.#push("--template", name);
  }

  /** Skip the implicit `dart pub get` (`--no-pub`). */
  noPub(): this {
    return this.#push("--no-pub");
  }

  /** Create into a directory that already exists (`--force`). */
  force(): this {
    return this.#push("--force");
  }

  /** Assemble the `dart create` argv. */
  protected override buildArgs(): string[] {
    if (this.#dir === undefined) {
      throw new Error("DartTasks.create: .dir() is required.");
    }
    return ["create", ...this.#flags, this.#dir];
  }
}

/** Settings for `dart doc`. */
export class DartDocSettings extends DartSettings {
  #dir?: string;
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The package directory to document (defaults to the current one). */
  dir(path: PathLike): this {
    this.#dir = pathOperand(path);
    return this;
  }

  /** Where to write the generated docs, instead of `doc/api` (`--output`). */
  output(path: PathLike): this {
    return this.#push("--output", String(path));
  }

  /** Check the generated docs for broken links (`--validate-links`). */
  validateLinks(): this {
    return this.#push("--validate-links");
  }

  /** Report what would be documented without writing files (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Assemble the `dart doc` argv. */
  protected override buildArgs(): string[] {
    const argv = ["doc", ...this.#flags];
    return this.#dir === undefined ? argv : [...argv, this.#dir];
  }
}

/** Settings for `dart fix`. */
export class DartFixSettings extends DartSettings {
  #dir?: string;
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The directory to fix (defaults to the current one). */
  dir(path: PathLike): this {
    this.#dir = pathOperand(path);
    return this;
  }

  /** Apply the proposed fixes (`--apply`). Without it or `.dryRun()`, `dart fix` only prints usage. */
  apply(): this {
    return this.#push("--apply");
  }

  /** List the proposed fixes without applying them (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Apply only the fix for one diagnostic code (`--code`); repeatable. */
  code(code: string): this {
    return this.#push("--code", code);
  }

  /** Assemble the `dart fix` argv. */
  protected override buildArgs(): string[] {
    const argv = ["fix", ...this.#flags];
    return this.#dir === undefined ? argv : [...argv, this.#dir];
  }
}

/** Settings for `dart info`, which prints diagnostic details about the SDK. */
export class DartInfoSettings extends DartSettings {
  #keepPaths = false;

  /** Keep file paths in the output instead of redacting them (`--no-remove-file-paths`). */
  noRemoveFilePaths(): this {
    this.#keepPaths = true;
    return this;
  }

  /** Assemble the `dart info` argv. */
  protected override buildArgs(): string[] {
    return this.#keepPaths ? ["info", "--no-remove-file-paths"] : ["info"];
  }
}

/** Settings for `dart --version`. */
export class DartVersionSettings extends DartSettings {
  /** Assemble the `dart --version` argv. */
  protected override buildArgs(): string[] {
    return ["--version"];
  }
}
