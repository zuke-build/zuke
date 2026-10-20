// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the SDK commands: `flutter doctor`, `flutter precache`,
 * `flutter config` and `flutter --version`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { flagName } from "./operand.ts";
import { FlutterSettings } from "./settings.ts";

/** Settings for `flutter doctor`. */
export class FlutterDoctorSettings extends FlutterSettings {
  #verbose = false;

  /** Show full details for every check (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Assemble the `flutter doctor` argv. */
  protected override buildArgs(): string[] {
    return this.#verbose ? ["doctor", "--verbose"] : ["doctor"];
  }
}

/** Settings for `flutter precache`, which downloads platform artifacts. */
export class FlutterPrecacheSettings extends FlutterSettings {
  #platforms: string[] = [];
  #force = false;

  /** Fetch a platform's artifacts, e.g. `android` → `--android`; repeatable. */
  platform(name: string): this {
    this.#platforms.push(`--${flagName("precache", name)}`);
    return this;
  }

  /** Re-download even when cached (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `flutter precache` argv. */
  protected override buildArgs(): string[] {
    const argv = ["precache", ...this.#platforms];
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `flutter config`. */
export class FlutterConfigSettings extends FlutterSettings {
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** Turn a feature on, e.g. `web` → `--enable-web`; repeatable. */
  enable(feature: string): this {
    return this.#push(`--enable-${flagName("config", feature)}`);
  }

  /** Turn a feature off, e.g. `web` → `--no-enable-web`; repeatable. */
  disable(feature: string): this {
    return this.#push(`--no-enable-${flagName("config", feature)}`);
  }

  /** The Android SDK directory (`--android-sdk`). */
  androidSdk(dir: PathLike): this {
    return this.#push("--android-sdk", String(dir));
  }

  /** Turn analytics reporting off (`--no-analytics`). */
  noAnalytics(): this {
    return this.#push("--no-analytics");
  }

  /** Reset every feature flag to its default (`--clear-features`). */
  clearFeatures(): this {
    return this.#push("--clear-features");
  }

  /** Assemble the `flutter config` argv. */
  protected override buildArgs(): string[] {
    return ["config", ...this.#flags];
  }
}

/** Settings for `flutter --version`. */
export class FlutterVersionSettings extends FlutterSettings {
  #machine = false;

  /** Print the versions as JSON (`--machine`). */
  machine(): this {
    this.#machine = true;
    return this;
  }

  /** Assemble the `flutter --version` argv. */
  protected override buildArgs(): string[] {
    return this.#machine ? ["--version", "--machine"] : ["--version"];
  }
}
