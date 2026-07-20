/**
 * `TsdownTasks` — typed task functions for the [tsdown](https://tsdown.dev)
 * bundler, in the settings-lambda style: configure a fluent settings object in
 * a lambda, and the task builds the command line and executes it.
 *
 * tsdown is a Rolldown-powered, tsup-like bundler. {@link TsdownTasks.build}
 * maps to `tsdown <entries> <flags>`, and {@link TsdownTasks.migrate} maps to
 * `tsdown migrate <flags>` (which migrates an existing tsup project to tsdown).
 *
 * ```ts
 * import { TsdownTasks } from "jsr:@zuke/tsdown";
 * await TsdownTasks.build((s) =>
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
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** An output format accepted by tsdown's `--format`. */
export type TsdownFormat = "esm" | "cjs" | "iife" | "umd";

/** Settings for a `tsdown` bundle run (`tsdown [entries] [flags]`). */
export class TsdownBuildSettings extends ToolSettings {
  #entries: string[] = [];
  #formats: TsdownFormat[] = [];
  #dts = false;
  #minify = false;
  #sourcemap = false;
  #clean = false;
  #watch = false;
  #outDir?: string;
  #target?: string;
  #tsconfig?: string;
  #config?: string;
  #platform?: string;
  #treeshake = false;

  /** The default executable to run: `tsdown`. */
  protected override defaultTool(): string {
    return "tsdown";
  }

  /** Resolve the binary from `node_modules/.bin` by default — tsdown is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Entry point(s) to bundle (positional); repeatable. */
  entry(...paths: PathLike[]): this {
    this.#entries.push(...paths.map(String));
    return this;
  }

  /** Output format(s), joined into `--format` (e.g. `esm,cjs`). */
  format(...formats: TsdownFormat[]): this {
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

  /** Path to a tsdown config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Target platform, e.g. `node`, `browser`, or `neutral` (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Enable tree-shaking of the output (`--treeshake`). */
  treeshake(): this {
    this.#treeshake = true;
    return this;
  }

  /** Assemble the `tsdown [entries] [flags]` argv. */
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
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#treeshake) argv.push("--treeshake");
    return argv;
  }
}

/** Settings for a `tsdown migrate` run (`tsdown migrate [flags]`). */
export class TsdownMigrateSettings extends ToolSettings {
  #from?: string;
  #dryRun = false;

  /** The default executable to run: `tsdown`. */
  protected override defaultTool(): string {
    return "tsdown";
  }

  /** Resolve the binary from `node_modules/.bin` by default — tsdown is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** The tool to migrate from, e.g. `tsup` (`--from`). */
  from(value: string): this {
    this.#from = value;
    return this;
  }

  /** Preview the migration without writing any files (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Assemble the `tsdown migrate [flags]` argv. */
  protected override buildArgs(): string[] {
    return [
      "migrate",
      ...(this.#from !== undefined ? ["--from", this.#from] : []),
      ...(this.#dryRun ? ["--dry-run"] : []),
    ];
  }
}

/** The shape of {@link TsdownTasks}. */
export interface TsdownTasksApi {
  /** Bundle the entry points: `tsdown`. */
  build(configure?: Configure<TsdownBuildSettings>): Promise<CommandOutput>;
  /** Migrate an existing project to tsdown: `tsdown migrate`. */
  migrate(configure?: Configure<TsdownMigrateSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsdown` bundler. */
export const TsdownTasks: TsdownTasksApi = {
  build(configure?: Configure<TsdownBuildSettings>): Promise<CommandOutput> {
    return runSettings(new TsdownBuildSettings(), configure);
  },
  migrate(
    configure?: Configure<TsdownMigrateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TsdownMigrateSettings(), configure);
  },
};
