/**
 * `TscTasks` — typed task functions for `tsc`, the TypeScript compiler, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * Two tasks are exposed: {@link TscTasks.tsc} for a standard compile or
 * type-check (the bare `tsc` invocation), and {@link TscTasks.build} for a
 * project-references build (`tsc --build`). Both share a small base that
 * resolves the `tsc` binary.
 *
 * ```ts
 * import { TscTasks } from "jsr:@zuke/tsc";
 * await TscTasks.tsc((s) => s.project("tsconfig.json").noEmit().pretty());
 * await TscTasks.build((s) => s.projects("packages/a").verbose());
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

/** Shared base for `tsc` settings; resolves the `tsc` binary. */
export abstract class TscBaseSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "tsc";
  }
}

/** Settings for a standard `tsc` run. */
export class TscSettings extends TscBaseSettings {
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

/** Settings for a `tsc --build` project-references run. */
export class TscBuildSettings extends TscBaseSettings {
  #projects: string[] = [];
  #clean = false;
  #force = false;
  #dry = false;
  #watch = false;
  #verbose = false;
  #incremental = false;

  /** Project config files or directories to build (positional); repeatable. */
  projects(...values: PathLike[]): this {
    this.#projects.push(...values.map(String));
    return this;
  }

  /** Delete the outputs of all projects (`--clean`). */
  clean(): this {
    this.#clean = true;
    return this;
  }

  /** Build all projects, even those that appear up to date (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Show what would be built without building it (`--dry`). */
  dry(): this {
    this.#dry = true;
    return this;
  }

  /** Rebuild projects on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Print verbose logging about the build (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Reuse prior build information for faster rebuilds (`--incremental`). */
  incremental(): this {
    this.#incremental = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = ["--build"];
    if (this.#clean) argv.push("--clean");
    if (this.#force) argv.push("--force");
    if (this.#dry) argv.push("--dry");
    if (this.#watch) argv.push("--watch");
    if (this.#verbose) argv.push("--verbose");
    if (this.#incremental) argv.push("--incremental");
    argv.push(...this.#projects);
    return argv;
  }
}

/** The shape of {@link TscTasks}. */
export interface TscTasksApi {
  /** Type-check (or compile) with `tsc`. */
  tsc(configure?: Configure<TscSettings>): Promise<CommandOutput>;
  /** Run a project-references build with `tsc --build`. */
  build(configure?: Configure<TscBuildSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsc` TypeScript compiler. */
export const TscTasks: TscTasksApi = {
  tsc(configure?: Configure<TscSettings>): Promise<CommandOutput> {
    return runSettings(new TscSettings(), configure);
  },
  build(configure?: Configure<TscBuildSettings>): Promise<CommandOutput> {
    return runSettings(new TscBuildSettings(), configure);
  },
};
