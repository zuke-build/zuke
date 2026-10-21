// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `dart run`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { DartVmSettings } from "./settings.ts";

/**
 * Settings for `dart run`. The entry point is the last token the settings
 * build, so anything passed through `.args()` lands after it and reaches the
 * program, not the VM.
 */
export class DartRunSettings extends DartVmSettings {
  #entry?: string;

  /**
   * The Dart file to run, or a package executable such as `build_runner` or
   * `test:test`. Without one, `dart run` runs the current package's own
   * executable.
   */
  entry(fileOrTarget: PathLike): this {
    this.#entry = pathOperand(fileOrTarget);
    return this;
  }

  /** Start the VM service and pause until a debugger attaches (`--observe`). */
  observe(): this {
    return this.vmFlag("--observe");
  }

  /** Start the VM service without pausing (`--enable-vm-service`). */
  enableVmService(): this {
    return this.vmFlag("--enable-vm-service");
  }

  /** Assemble the `dart run` argv. */
  protected override buildArgs(): string[] {
    const argv = ["run", ...this.vmArgs()];
    return this.#entry === undefined ? argv : [...argv, this.#entry];
  }
}
