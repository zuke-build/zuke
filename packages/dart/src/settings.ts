// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The settings bases every `dart` subcommand builds on: the binary and its
 * resolution, and the VM flags shared by `compile` and `run`.
 *
 * @module
 */

import {
  type PathLike,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";

/** Base for all `dart` settings: the binary is `dart`, found on `PATH`. */
export abstract class DartSettings extends ToolSettings {
  /** The binary these settings invoke: `dart`. */
  protected override defaultTool(): string {
    return "dart";
  }

  /** Resolve from `PATH` — the Dart SDK is installed natively. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }
}

/**
 * Flags shared by the commands that load Dart code into the VM — `compile`
 * and `run`: `--define`, `--enable-asserts`, `--enable-experiment`,
 * `--packages` and `--verbosity`. Valued options render as `--flag=value`:
 * `dart compile js` hands its argv to dart2js, whose parser accepts only that
 * spelling, and Dart's `args` package accepts it everywhere else.
 */
export abstract class DartVmSettings extends DartSettings {
  #vmFlags: string[] = [];

  /** Push the shared flags in call order. */
  protected vmFlag(...tokens: string[]): this {
    this.#vmFlags.push(...tokens);
    return this;
  }

  /** Define an environment declaration (`--define=name=value`); repeatable. */
  define(name: string, value: string): this {
    return this.vmFlag(`--define=${name}=${value}`);
  }

  /** Enable assert statements (`--enable-asserts`). */
  enableAsserts(): this {
    return this.vmFlag("--enable-asserts");
  }

  /** Enable an experimental language feature (`--enable-experiment`); repeatable. */
  enableExperiment(name: string): this {
    return this.vmFlag(`--enable-experiment=${name}`);
  }

  /** The package resolution file to use (`--packages`). */
  packages(path: PathLike): this {
    return this.vmFlag(`--packages=${String(path)}`);
  }

  /** How much to print: `error`, `warning`, `info` or `all` (`--verbosity`). */
  verbosity(level: "error" | "warning" | "info" | "all"): this {
    return this.vmFlag(`--verbosity=${level}`);
  }

  /** The shared VM flags, in call order. */
  protected vmArgs(): string[] {
    return [...this.#vmFlags];
  }
}
