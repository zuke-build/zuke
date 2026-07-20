/**
 * `TsupTasks` — a typed task function for the [tsup](https://tsup.egoist.dev)
 * bundler, in the settings-lambda style: configure a fluent settings object in
 * a lambda, and the task builds the command line and executes it.
 *
 * tsup is a single-command tool (no subcommands): it bundles the given entry
 * points. {@link TsupTasks.build} maps to `tsup <entries> <flags>`.
 *
 * ```ts
 * import { TsupTasks } from "jsr:@zuke/tsup";
 * await TsupTasks.build((s) =>
 *   s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
 * );
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

/** An output format accepted by tsup's `--format`. */
export type TsupFormat = "esm" | "cjs" | "iife";

/** Settings for a `tsup` bundle run. */
export class TsupBuildSettings extends ToolSettings {
  #entries: string[] = [];
  #formats: TsupFormat[] = [];
  #dts = false;
  #minify = false;
  #sourcemap = false;
  #clean = false;
  #watch = false;
  #outDir?: string;
  #target?: string;
  #tsconfig?: string;
  #config?: string;

  /** The executable this settings object runs: `tsup`. */
  protected override defaultTool(): string {
    return "tsup";
  }

  /** Entry point(s) to bundle (positional); repeatable. */
  entry(...paths: PathLike[]): this {
    this.#entries.push(...paths.map(String));
    return this;
  }

  /** Output format(s), joined into `--format` (e.g. `esm,cjs`). */
  format(...formats: TsupFormat[]): this {
    this.#formats.push(...formats);
    return this;
  }

  /** Emit TypeScript declaration files (`--dts`). */
  dts(): this {
    this.#dts = true;
    return this;
  }

  /** Minify the output (`--minify`). */
  minify(): this {
    this.#minify = true;
    return this;
  }

  /** Emit source maps (`--sourcemap`). */
  sourcemap(): this {
    this.#sourcemap = true;
    return this;
  }

  /** Clean the output directory before building (`--clean`). */
  clean(): this {
    this.#clean = true;
    return this;
  }

  /** Rebuild on change (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Output directory (`--out-dir`). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** Compilation target, e.g. `es2022` or `node18` (`--target`). */
  target(value: string): this {
    this.#target = value;
    return this;
  }

  /** Path to a tsconfig file (`--tsconfig`). */
  tsconfig(path: PathLike): this {
    this.#tsconfig = String(path);
    return this;
  }

  /** Path to a tsup config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Assemble the `tsup <entries> <flags>` argv. */
  protected override buildArgs(): string[] {
    const argv: string[] = [...this.#entries];
    if (this.#formats.length > 0) {
      argv.push("--format", this.#formats.join(","));
    }
    if (this.#dts) argv.push("--dts");
    if (this.#minify) argv.push("--minify");
    if (this.#sourcemap) argv.push("--sourcemap");
    if (this.#clean) argv.push("--clean");
    if (this.#watch) argv.push("--watch");
    if (this.#outDir !== undefined) argv.push("--out-dir", this.#outDir);
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#tsconfig !== undefined) argv.push("--tsconfig", this.#tsconfig);
    if (this.#config !== undefined) argv.push("--config", this.#config);
    return argv;
  }
}

/** The shape of {@link TsupTasks}. */
export interface TsupTasksApi {
  /** Bundle the entry points: `tsup`. */
  build(configure?: Configure<TsupBuildSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsup` bundler. */
export const TsupTasks: TsupTasksApi = {
  build(configure?: Configure<TsupBuildSettings>): Promise<CommandOutput> {
    return runSettings(new TsupBuildSettings(), configure);
  },
};
