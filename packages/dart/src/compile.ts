// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `dart compile <target>`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand, wholeNumber } from "./operand.ts";
import { DartVmSettings } from "./settings.ts";

/** A setter of {@link DartCompileSettings} that not every target accepts. */
type GatedSetter =
  | "enableAsserts"
  | "verbosity"
  | "targetOs"
  | "saveDebuggingInfo"
  | "depfile"
  | "optimize";

/** A `dart compile` target: what the entry point is compiled to. */
export type DartCompileTarget =
  | "aot-snapshot"
  | "exe"
  | "jit-snapshot"
  | "js"
  | "kernel"
  | "wasm";

/** An operating system `dart compile exe|aot-snapshot` can target (`--target-os`). */
export type DartTargetOs =
  | "android"
  | "fuchsia"
  | "ios"
  | "linux"
  | "macos"
  | "windows";

/** The `DartTasks` method that runs each target, for error messages. */
const TASK: Record<DartCompileTarget, string> = {
  "aot-snapshot": "compileAotSnapshot",
  exe: "compileExe",
  "jit-snapshot": "compileJitSnapshot",
  js: "compileJs",
  kernel: "compileKernel",
  wasm: "compileWasm",
};

/**
 * The setters each target's `dart compile` grammar rejects, from the SDK's own
 * option tables; a setter not listed here is accepted by that target.
 */
const UNSUPPORTED: Record<DartCompileTarget, readonly GatedSetter[]> = {
  "aot-snapshot": ["optimize"],
  exe: ["optimize"],
  "jit-snapshot": ["targetOs", "saveDebuggingInfo", "optimize"],
  kernel: ["enableAsserts", "targetOs", "saveDebuggingInfo", "optimize"],
  js: ["targetOs", "saveDebuggingInfo", "depfile"],
  wasm: ["verbosity", "targetOs", "saveDebuggingInfo"],
};

/** Settings for `dart compile <target>`. */
export class DartCompileSettings extends DartVmSettings {
  readonly #target: DartCompileTarget;
  #entry?: string;
  #flags: string[] = [];

  /** Settings for `dart compile <target>`. */
  constructor(target: DartCompileTarget) {
    super();
    this.#target = target;
  }

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** Refuse a setter this target's grammar has no option for. */
  #accept(setter: GatedSetter): void {
    if (UNSUPPORTED[this.#target].includes(setter)) {
      throw new Error(
        `DartTasks.${TASK[this.#target]}: .${setter}() is not accepted by ` +
          `dart compile ${this.#target}.`,
      );
    }
  }

  /** Enable assert statements (`--enable-asserts`); not for `kernel`. */
  override enableAsserts(): this {
    this.#accept("enableAsserts");
    return super.enableAsserts();
  }

  /** How much to print (`--verbosity`); not for `wasm`. */
  override verbosity(level: "error" | "warning" | "info" | "all"): this {
    this.#accept("verbosity");
    return super.verbosity(level);
  }

  /** The Dart entry point to compile; required. */
  entry(path: PathLike): this {
    this.#entry = pathOperand(path);
    return this;
  }

  /** Where to write the compiled artifact (`--output`). */
  output(path: PathLike): this {
    return this.#push("--output", String(path));
  }

  /** Cross-compile for another OS (`--target-os`); `exe` and `aot-snapshot` only. */
  targetOs(os: DartTargetOs): this {
    this.#accept("targetOs");
    return this.#push("--target-os", os);
  }

  /** Strip debugging information into a separate file (`--save-debugging-info`); `exe` and `aot-snapshot` only. */
  saveDebuggingInfo(path: PathLike): this {
    this.#accept("saveDebuggingInfo");
    return this.#push("--save-debugging-info", String(path));
  }

  /** Write a Makefile-style dependency file (`--depfile`); not for `js`. */
  depfile(path: PathLike): this {
    this.#accept("depfile");
    return this.#push("--depfile", String(path));
  }

  /** The optimization level, `0` to `4` (`-O<level>`); `js` and `wasm` only. */
  optimize(level: number): this {
    this.#accept("optimize");
    const n = wholeNumber(TASK[this.#target], "optimize", level, 0);
    if (n > 4) {
      throw new Error(
        `DartTasks.${TASK[this.#target]}: .optimize() takes a level from 0 ` +
          `to 4, not ${level}.`,
      );
    }
    return this.#push(`-O${n}`);
  }

  /** Assemble the `dart compile <target>` argv. */
  protected override buildArgs(): string[] {
    if (this.#entry === undefined) {
      throw new Error(`DartTasks.${TASK[this.#target]}: .entry() is required.`);
    }
    return [
      "compile",
      this.#target,
      ...this.#flags,
      ...this.vmArgs(),
      this.#entry,
    ];
  }
}
