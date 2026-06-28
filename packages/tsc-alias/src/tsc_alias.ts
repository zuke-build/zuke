/**
 * `TscAliasTasks` — typed task functions for `tsc-alias`, the tool that
 * rewrites TypeScript path aliases in compiled output, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * `tsc-alias` has no subcommands, so the single {@link TscAliasTasks.run} task
 * matches the bare invocation and exposes its real flags. It defaults to
 * resolving `./tsconfig.json`, so no setting is required.
 *
 * ```ts
 * import { TscAliasTasks } from "jsr:@zuke/tsc-alias";
 * await TscAliasTasks.run((s) => s.project("tsconfig.json").resolveFullPaths());
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

/** Settings for a `tsc-alias` run. */
export class TscAliasRunSettings extends ToolSettings {
  #project?: string;
  #watch = false;
  #outDir?: string;
  #declarationDir?: string;
  #resolveFullPaths = false;
  #resolveFullExtension?: string;
  #replacers: string[] = [];
  #dir?: string;
  #fileExtensions?: string;
  #verbose = false;
  #debug = false;
  #silent = false;

  protected override defaultTool(): string {
    return "tsc-alias";
  }

  /** Path to the `tsconfig.json` to read aliases from (`-p`/`--project`). */
  project(path: PathLike): this {
    this.#project = String(path);
    return this;
  }

  /** Re-run on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Output directory of the compiled files to rewrite (`--outDir`). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** Output directory of the emitted declaration files (`--declarationDir`). */
  declarationDir(path: PathLike): this {
    this.#declarationDir = String(path);
    return this;
  }

  /** Attempt to fully resolve alias paths, including extensions (`--resolveFullPaths`). */
  resolveFullPaths(): this {
    this.#resolveFullPaths = true;
    return this;
  }

  /** Extension to append when resolving full paths, e.g. `.js` (`--resolveFullExtension`). */
  resolveFullExtension(ext: string): this {
    this.#resolveFullExtension = ext;
    return this;
  }

  /** Additional replacer module file(s); repeatable (`-f`/`--replacers`). */
  replacers(...files: PathLike[]): this {
    for (const file of files) {
      this.#replacers.push("--replacers", String(file));
    }
    return this;
  }

  /** Base directory to resolve relative paths against (`--dir`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Comma-separated list of file extensions to process (`--fileExtensions`). */
  fileExtensions(list: string): this {
    this.#fileExtensions = list;
    return this;
  }

  /** Print verbose output (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Print debug output (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  /** Suppress all output (`--silent`). */
  silent(): this {
    this.#silent = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#project !== undefined) argv.push("-p", this.#project);
    if (this.#watch) argv.push("--watch");
    if (this.#outDir !== undefined) argv.push("--outDir", this.#outDir);
    if (this.#declarationDir !== undefined) {
      argv.push("--declarationDir", this.#declarationDir);
    }
    if (this.#resolveFullPaths) argv.push("--resolveFullPaths");
    if (this.#resolveFullExtension !== undefined) {
      argv.push("--resolveFullExtension", this.#resolveFullExtension);
    }
    argv.push(...this.#replacers);
    if (this.#dir !== undefined) argv.push("--dir", this.#dir);
    if (this.#fileExtensions !== undefined) {
      argv.push("--fileExtensions", this.#fileExtensions);
    }
    if (this.#verbose) argv.push("--verbose");
    if (this.#debug) argv.push("--debug");
    if (this.#silent) argv.push("--silent");
    return argv;
  }
}

/** The shape of {@link TscAliasTasks}. */
export interface TscAliasTasksApi {
  /** Rewrite TypeScript path aliases in compiled output with `tsc-alias`. */
  run(configure?: Configure<TscAliasRunSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsc-alias` path-alias rewriter. */
export const TscAliasTasks: TscAliasTasksApi = {
  run(configure?: Configure<TscAliasRunSettings>): Promise<CommandOutput> {
    return runSettings(new TscAliasRunSettings(), configure);
  },
};
