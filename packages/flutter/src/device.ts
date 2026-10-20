// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the commands that talk to a device: `flutter drive`,
 * `flutter install` and `flutter devices`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import {
  FlutterAppSettings,
  type FlutterBuildMode,
  FlutterSettings,
} from "./settings.ts";

/** Settings for `flutter drive`, which runs integration tests on a device. */
export class FlutterDriveSettings extends FlutterAppSettings {
  #driver?: string;
  #deviceId?: string;
  #screenshot?: string;

  /** The test driver file, e.g. `test_driver/integration_test.dart` (`--driver`). */
  driver(path: PathLike): this {
    this.#driver = String(path);
    return this;
  }

  /** The device to run on, e.g. `chrome` or an emulator id (`--device-id`). */
  deviceId(id: string): this {
    this.#deviceId = id;
    return this;
  }

  /** Save a screenshot to this directory if the run fails (`--screenshot`). */
  screenshot(dir: PathLike): this {
    this.#screenshot = String(dir);
    return this;
  }

  /** Assemble the `flutter drive` argv. */
  protected override buildArgs(): string[] {
    const argv = ["drive", ...this.appArgs()];
    if (this.#driver !== undefined) argv.push("--driver", this.#driver);
    if (this.#deviceId !== undefined) argv.push("--device-id", this.#deviceId);
    if (this.#screenshot !== undefined) {
      argv.push("--screenshot", this.#screenshot);
    }
    return argv;
  }
}

/** Settings for `flutter install`, which installs a built app on a device. */
export class FlutterInstallSettings extends FlutterSettings {
  #mode?: FlutterBuildMode;
  #flavor?: string;
  #deviceId?: string;
  #binary?: string;
  #uninstallOnly = false;

  /** Install the build of this mode (`--debug`, `--profile` or `--release`). */
  mode(mode: FlutterBuildMode): this {
    this.#mode = mode;
    return this;
  }

  /** Install this build flavor (`--flavor`). */
  flavor(name: string): this {
    this.#flavor = name;
    return this;
  }

  /** The device to install on (`--device-id`). */
  deviceId(id: string): this {
    this.#deviceId = id;
    return this;
  }

  /** Install this prebuilt binary instead (`--use-application-binary`). */
  useApplicationBinary(path: PathLike): this {
    this.#binary = String(path);
    return this;
  }

  /** Only uninstall the app (`--uninstall-only`). */
  uninstallOnly(): this {
    this.#uninstallOnly = true;
    return this;
  }

  /** Assemble the `flutter install` argv. */
  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#mode !== undefined) argv.push(`--${this.#mode}`);
    if (this.#flavor !== undefined) argv.push("--flavor", this.#flavor);
    if (this.#deviceId !== undefined) argv.push("--device-id", this.#deviceId);
    if (this.#binary !== undefined) {
      argv.push("--use-application-binary", this.#binary);
    }
    if (this.#uninstallOnly) argv.push("--uninstall-only");
    return argv;
  }
}

/** Settings for `flutter devices`. */
export class FlutterDevicesSettings extends FlutterSettings {
  #machine = false;

  /** Print the devices as JSON (`--machine`). */
  machine(): this {
    this.#machine = true;
    return this;
  }

  /** Assemble the `flutter devices` argv. */
  protected override buildArgs(): string[] {
    return this.#machine ? ["devices", "--machine"] : ["devices"];
  }
}
