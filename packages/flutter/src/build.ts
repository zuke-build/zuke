// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `flutter build <target>`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { FlutterAppSettings } from "./settings.ts";

/** The artifact `flutter build` produces — its subcommand. */
export type FlutterBuildTarget =
  | "aar"
  | "apk"
  | "appbundle"
  | "ios"
  | "ipa"
  | "linux"
  | "macos"
  | "web"
  | "windows";

/**
 * Settings for `flutter build <target>`. Flags that only one target accepts say
 * so; `flutter` rejects them for the others.
 */
export class FlutterBuildSettings extends FlutterAppSettings {
  readonly #kind: FlutterBuildTarget;
  #flags: string[] = [];
  #targetPlatforms: string[] = [];

  /** Settings for `flutter build <kind>`. */
  constructor(kind: FlutterBuildTarget) {
    super();
    this.#kind = kind;
  }

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** The version name, e.g. `1.4.0` (`--build-name`). */
  buildName(name: string): this {
    return this.#push("--build-name", name);
  }

  /** The build number, e.g. the CI run number (`--build-number`). */
  buildNumber(number: string | number): this {
    return this.#push("--build-number", String(number));
  }

  /** Obfuscate Dart symbols (`--obfuscate`); needs {@link splitDebugInfo}. */
  obfuscate(): this {
    return this.#push("--obfuscate");
  }

  /** Write split debug symbols to a directory (`--split-debug-info`). */
  splitDebugInfo(dir: PathLike): this {
    return this.#push("--split-debug-info", String(dir));
  }

  /** Keep every icon font glyph (`--no-tree-shake-icons`). */
  noTreeShakeIcons(): this {
    return this.#push("--no-tree-shake-icons");
  }

  /**
   * The platform to build for (`--target-platform`). Android takes several ABIs,
   * e.g. `android-arm64`, joined into one list; `linux` and `windows` take one,
   * e.g. `linux-arm64`.
   */
  targetPlatform(platform: string): this {
    this.#targetPlatforms.push(platform);
    return this;
  }

  /** `apk`: one APK per ABI (`--split-per-abi`). */
  splitPerAbi(): this {
    return this.#push("--split-per-abi");
  }

  /** `ios`: build without code signing (`--no-codesign`). */
  noCodesign(): this {
    return this.#push("--no-codesign");
  }

  /** `ipa`: the export method, e.g. `app-store` or `ad-hoc` (`--export-method`). */
  exportMethod(method: string): this {
    return this.#push("--export-method", method);
  }

  /** `ipa`: the export options plist (`--export-options-plist`). */
  exportOptionsPlist(path: PathLike): this {
    return this.#push("--export-options-plist", String(path));
  }

  /** `web`: the base href of the app, e.g. `/app/` (`--base-href`). */
  baseHref(href: string): this {
    return this.#push("--base-href", href);
  }

  /** `web`: compile to WebAssembly (`--wasm`). */
  wasm(): this {
    return this.#push("--wasm");
  }

  /** `web`: emit source maps (`--source-maps`). */
  sourceMaps(): this {
    return this.#push("--source-maps");
  }

  /** `web`: the output directory, instead of `build/web` (`--output`). */
  output(dir: PathLike): this {
    return this.#push("--output", String(dir));
  }

  /** Assemble the `flutter build <target>` argv. */
  protected override buildArgs(): string[] {
    const argv = ["build", this.#kind, ...this.appArgs(), ...this.#flags];
    if (this.#targetPlatforms.length > 0) {
      argv.push("--target-platform", this.#targetPlatforms.join(","));
    }
    return argv;
  }
}
