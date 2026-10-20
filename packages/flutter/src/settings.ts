// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The settings bases every `flutter` subcommand builds on: the binary and its
 * resolution, the compile flags shared by `test`, `build` and `drive`, and the
 * build mode and entry point shared by `build` and `drive`.
 *
 * @module
 */

import {
  type PathLike,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";

/** A Flutter build mode, rendered as `--debug`, `--profile` or `--release`. */
export type FlutterBuildMode = "debug" | "profile" | "release";

/** Base for all `flutter` settings: the binary is `flutter`, found on `PATH`. */
export abstract class FlutterSettings extends ToolSettings {
  /** The binary these settings invoke: `flutter`. */
  protected override defaultTool(): string {
    return "flutter";
  }

  /** Resolve from `PATH` — the Flutter SDK is installed natively. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }
}

/**
 * Flags shared by the commands that compile Dart code: `--no-pub`,
 * `--dart-define`, `--dart-define-from-file` and `--flavor`.
 */
export abstract class FlutterCompileSettings extends FlutterSettings {
  #noPub = false;
  #defines: string[] = [];
  #defineFiles: string[] = [];
  #flavor?: string;

  /** Skip the implicit `flutter pub get` (`--no-pub`). */
  noPub(): this {
    this.#noPub = true;
    return this;
  }

  /** Define a compile-time constant (`--dart-define=name=value`); repeatable. */
  dartDefine(name: string, value: string): this {
    this.#defines.push(`--dart-define=${name}=${value}`);
    return this;
  }

  /** Read compile-time constants from a JSON or `.env` file (`--dart-define-from-file`); repeatable. */
  dartDefineFromFile(path: PathLike): this {
    this.#defineFiles.push(`--dart-define-from-file=${String(path)}`);
    return this;
  }

  /** The build flavor, for apps with product flavors or schemes (`--flavor`). */
  flavor(name: string): this {
    this.#flavor = name;
    return this;
  }

  /** The shared compile flags, in a stable order. */
  protected compileArgs(): string[] {
    const argv: string[] = [];
    if (this.#noPub) argv.push("--no-pub");
    argv.push(...this.#defines, ...this.#defineFiles);
    if (this.#flavor !== undefined) argv.push("--flavor", this.#flavor);
    return argv;
  }
}

/**
 * Compile flags plus the build mode and the entry point (`--target`), shared by
 * `flutter build` and `flutter drive`.
 */
export abstract class FlutterAppSettings extends FlutterCompileSettings {
  #mode?: FlutterBuildMode;
  #target?: string;

  /** The build mode (`--debug`, `--profile` or `--release`). */
  mode(mode: FlutterBuildMode): this {
    this.#mode = mode;
    return this;
  }

  /** Build in release mode (`--release`). */
  release(): this {
    return this.mode("release");
  }

  /** The main entry-point file, instead of `lib/main.dart` (`--target`). */
  target(path: PathLike): this {
    this.#target = String(path);
    return this;
  }

  /** The mode and entry point, then the shared compile flags. */
  protected appArgs(): string[] {
    const argv: string[] = [];
    if (this.#mode !== undefined) argv.push(`--${this.#mode}`);
    if (this.#target !== undefined) argv.push("--target", this.#target);
    return [...argv, ...this.compileArgs()];
  }
}
