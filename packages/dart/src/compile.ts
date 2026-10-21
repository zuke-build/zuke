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

  /** The Dart entry point to compile; required. */
  entry(path: PathLike): this {
    this.#entry = pathOperand(path);
    return this;
  }

  /** Where to write the compiled artifact (`--output`). */
  output(path: PathLike): this {
    return this.#push("--output", String(path));
  }

  /** Cross-compile `exe` or `aot-snapshot` for another OS (`--target-os`). */
  targetOs(os: DartTargetOs): this {
    return this.#push("--target-os", os);
  }

  /** Strip debugging information into a separate file (`--save-debugging-info`). */
  saveDebuggingInfo(path: PathLike): this {
    return this.#push("--save-debugging-info", String(path));
  }

  /** Write a Makefile-style dependency file (`--depfile`). */
  depfile(path: PathLike): this {
    return this.#push("--depfile", String(path));
  }

  /** The `js` and `wasm` optimization level, `0` to `4` (`-O<level>`). */
  optimize(level: number): this {
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
