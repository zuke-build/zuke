// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `flutter analyze`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { FlutterSettings } from "./settings.ts";

/** Settings for `flutter analyze`. */
export class FlutterAnalyzeSettings extends FlutterSettings {
  #paths: string[] = [];
  #noFatalInfos = false;
  #noFatalWarnings = false;
  #write?: string;

  /** A file or directory to analyze (defaults to the project); repeatable. */
  path(path: PathLike): this {
    this.#paths.push(pathOperand(path));
    return this;
  }

  /** Do not fail on info-level issues (`--no-fatal-infos`). */
  noFatalInfos(): this {
    this.#noFatalInfos = true;
    return this;
  }

  /** Do not fail on warnings (`--no-fatal-warnings`). */
  noFatalWarnings(): this {
    this.#noFatalWarnings = true;
    return this;
  }

  /** Also write the analysis results to a file (`--write`). */
  write(path: PathLike): this {
    this.#write = String(path);
    return this;
  }

  /** Assemble the `flutter analyze` argv. */
  protected override buildArgs(): string[] {
    const argv = ["analyze"];
    if (this.#noFatalInfos) argv.push("--no-fatal-infos");
    if (this.#noFatalWarnings) argv.push("--no-fatal-warnings");
    if (this.#write !== undefined) argv.push("--write", this.#write);
    return [...argv, ...this.#paths];
  }
}
