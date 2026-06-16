/**
 * `TsgoTasks` — typed task functions for `tsgo`, the native TypeScript
 * compiler (a.k.a. TypeScript 7 / `@typescript/native-preview`), in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * `tsgo` mirrors the `tsc` command-line surface, so this wrapper exposes the
 * common project, type-check, and emit flags. The default action type-checks;
 * pass `.noEmit()` to suppress output, or emit settings to compile.
 *
 * ```ts
 * import { TsgoTasks } from "jsr:@zuke/tsgo";
 * await TsgoTasks.check((s) => s.project("tsconfig.json").noEmit().pretty());
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `tsgo` run. */
export class TsgoSettings extends ToolSettings {
  #paths: string[] = [];
  #project?: string;
  #noEmit = false;
  #outDir?: string;
  #declaration = false;
  #emitDeclarationOnly = false;
  #incremental = false;
  #watch = false;
  #strict = false;
  #pretty = false;
  #listFiles = false;
  #skipLibCheck = false;
  #noEmitOnError = false;
  #target?: string;
  #module?: string;

  protected override defaultTool(): string {
    return "tsgo";
  }

  /** Source files to compile (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Compile the project at the given config or directory (`-p`/`--project`). */
  project(path: PathLike): this {
    this.#project = String(path);
    return this;
  }

  /** Type-check without emitting output (`--noEmit`). */
  noEmit(): this {
    this.#noEmit = true;
    return this;
  }

  /** Directory for emitted files (`--outDir`). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** Generate `.d.ts` declaration files (`--declaration`). */
  declaration(): this {
    this.#declaration = true;
    return this;
  }

  /** Emit declarations only, no JavaScript (`--emitDeclarationOnly`). */
  emitDeclarationOnly(): this {
    this.#emitDeclarationOnly = true;
    return this;
  }

  /** Reuse prior build information for faster rebuilds (`--incremental`). */
  incremental(): this {
    this.#incremental = true;
    return this;
  }

  /** Recompile on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Enable all strict type-checking options (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  /** Colourise and format diagnostics (`--pretty`). */
  pretty(): this {
    this.#pretty = true;
    return this;
  }

  /** Print the names of files included in the compilation (`--listFiles`). */
  listFiles(): this {
    this.#listFiles = true;
    return this;
  }

  /** Skip type-checking of declaration files (`--skipLibCheck`). */
  skipLibCheck(): this {
    this.#skipLibCheck = true;
    return this;
  }

  /** Do not emit output if any errors are reported (`--noEmitOnError`). */
  noEmitOnError(): this {
    this.#noEmitOnError = true;
    return this;
  }

  /** Target ECMAScript version, e.g. `es2022` (`--target`). */
  target(value: string): this {
    this.#target = value;
    return this;
  }

  /** Module system, e.g. `esnext`, `nodenext` (`--module`). */
  module(value: string): this {
    this.#module = value;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#project !== undefined) argv.push("-p", this.#project);
    if (this.#noEmit) argv.push("--noEmit");
    if (this.#outDir !== undefined) argv.push("--outDir", this.#outDir);
    if (this.#declaration) argv.push("--declaration");
    if (this.#emitDeclarationOnly) argv.push("--emitDeclarationOnly");
    if (this.#incremental) argv.push("--incremental");
    if (this.#watch) argv.push("--watch");
    if (this.#strict) argv.push("--strict");
    if (this.#pretty) argv.push("--pretty");
    if (this.#listFiles) argv.push("--listFiles");
    if (this.#skipLibCheck) argv.push("--skipLibCheck");
    if (this.#noEmitOnError) argv.push("--noEmitOnError");
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#module !== undefined) argv.push("--module", this.#module);
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link TsgoTasks}. */
export interface TsgoTasksApi {
  /** Type-check (or compile) with `tsgo`. */
  check(configure?: Configure<TsgoSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsgo` TypeScript compiler. */
export const TsgoTasks: TsgoTasksApi = {
  check(configure?: Configure<TsgoSettings>): Promise<CommandOutput> {
    return runSettings(new TsgoSettings(), configure);
  },
};
