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
 * program, not the VM — without an `.entry()`, the first `.args()` token is
 * what `dart run` takes as the program, exactly as on the command line.
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

  /**
   * Start the VM service with the debugging conveniences and pause on start
   * (`--observe=<port>[/<bind-address>]`). The value is attached with `=`
   * because `dart run` reads the option's value from the next token, which
   * would otherwise be the entry point.
   */
  observe(bind = "8181/localhost"): this {
    return this.vmFlag(`--observe=${bind}`);
  }

  /** Start the VM service without pausing (`--enable-vm-service=<port>[/<bind-address>]`). */
  enableVmService(bind = "8181/localhost"): this {
    return this.vmFlag(`--enable-vm-service=${bind}`);
  }

  /** Assemble the `dart run` argv. */
  protected override buildArgs(): string[] {
    const argv = ["run", ...this.vmArgs()];
    return this.#entry === undefined ? argv : [...argv, this.#entry];
  }
}
