// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `dart analyze`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { DartSettings } from "./settings.ts";

/** Settings for `dart analyze`. */
export class DartAnalyzeSettings extends DartSettings {
  #paths: string[] = [];
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** A file or directory to analyze (defaults to the current one); repeatable. */
  path(path: PathLike): this {
    this.#paths.push(pathOperand(path));
    return this;
  }

  /** Treat info-level issues as fatal (`--fatal-infos`). */
  fatalInfos(): this {
    return this.#push("--fatal-infos");
  }

  /** Do not fail on warnings (`--no-fatal-warnings`). */
  noFatalWarnings(): this {
    return this.#push("--no-fatal-warnings");
  }

  /** The output format: `default`, `json` or `machine` (`--format`). */
  format(name: "default" | "json" | "machine"): this {
    return this.#push("--format", name);
  }

  /** The package resolution file to use (`--packages`). */
  packages(path: PathLike): this {
    return this.#push("--packages", String(path));
  }

  /** Assemble the `dart analyze` argv. */
  protected override buildArgs(): string[] {
    return ["analyze", ...this.#flags, ...this.#paths];
  }
}
