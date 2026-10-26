// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `dart format`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand, wholeNumber } from "./operand.ts";
import { DartSettings } from "./settings.ts";

/**
 * Settings for `dart format`. With no `.path()` the current directory is
 * formatted: `dart format` itself would read stdin instead, and in CI — no
 * terminal, empty stdin — a `.setExitIfChanged()` check would pass vacuously.
 */
export class DartFormatSettings extends DartSettings {
  #paths: string[] = [];
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** A file or directory to format (defaults to `.`); repeatable. */
  path(path: PathLike): this {
    this.#paths.push(pathOperand(path));
    return this;
  }

  /** What to do with formatted code: `write` (default), `show`, `json` or `none` (`--output`). */
  output(mode: "write" | "show" | "json" | "none"): this {
    return this.#push("--output", mode);
  }

  /** Exit with code 1 when any file would change — the CI check (`--set-exit-if-changed`). */
  setExitIfChanged(): this {
    return this.#push("--set-exit-if-changed");
  }

  /** Wrap lines longer than this (`--line-length`). */
  lineLength(columns: number): this {
    return this.#push(
      "--line-length",
      String(wholeNumber("format", "lineLength", columns, 1)),
    );
  }

  /** Which files to list: `all`, `changed` (default) or `none` (`--show`). */
  show(which: "all" | "changed" | "none"): this {
    return this.#push("--show", which);
  }

  /** The summary to print: `line` (default), `profile` or `none` (`--summary`). */
  summary(kind: "line" | "profile" | "none"): this {
    return this.#push("--summary", kind);
  }

  /** Follow symbolic links into directories (`--follow-links`). */
  followLinks(): this {
    return this.#push("--follow-links");
  }

  /** The language version to parse as, e.g. `3.3` (`--language-version`). */
  languageVersion(version: string): this {
    return this.#push("--language-version", version);
  }

  /** Enable an experimental language feature (`--enable-experiment`); repeatable. */
  enableExperiment(name: string): this {
    return this.#push("--enable-experiment", name);
  }

  /** Assemble the `dart format` argv. */
  protected override buildArgs(): string[] {
    return [
      "format",
      ...this.#flags,
      ...(this.#paths.length > 0 ? this.#paths : ["."]),
    ];
  }
}
