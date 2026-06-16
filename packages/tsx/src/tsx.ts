/**
 * `TsxTasks` — typed task functions for the `tsx` TypeScript runner, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * `tsx` runs a TypeScript entry point directly (transpiling on the fly). This
 * wrapper executes the entry point once by default and switches to `tsx watch`
 * via {@link TsxSettings.watch}.
 *
 * ```ts
 * import { TsxTasks } from "jsr:@zuke/tsx";
 * await TsxTasks.run((s) => s.script("src/main.ts").tsconfig("tsconfig.json"));
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

/** Settings for a `tsx` run. */
export class TsxSettings extends ToolSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #watch = false;
  #tsconfig?: string;
  #envFile?: string;
  #noCache = false;
  #noWarnings = false;
  #conditions: string[] = [];
  #imports: string[] = [];
  #noClearScreen = false;
  #includes: string[] = [];
  #excludes: string[] = [];

  protected override defaultTool(): string {
    return "tsx";
  }

  /** The entry point to execute (required). */
  script(path: PathLike): this {
    this.#script = String(path);
    return this;
  }

  /** Arguments passed to the script (after the entry point). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Re-run on file changes (`tsx watch`) instead of the default one-shot run. */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Use an explicit `tsconfig.json` (`--tsconfig`). */
  tsconfig(path: PathLike): this {
    this.#tsconfig = String(path);
    return this;
  }

  /** Load environment variables from a file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Disable the file-system transpile cache (`--no-cache`). */
  noCache(): this {
    this.#noCache = true;
    return this;
  }

  /** Suppress Node warnings (`--no-warnings`). */
  noWarnings(): this {
    this.#noWarnings = true;
    return this;
  }

  /** Custom export conditions to resolve (`--conditions`); repeatable. */
  conditions(...names: string[]): this {
    for (const name of names) this.#conditions.push("--conditions", name);
    return this;
  }

  /** Preload a module before the entry point (`--import`); repeatable. */
  importModule(...modules: string[]): this {
    for (const module of modules) this.#imports.push("--import", module);
    return this;
  }

  /** Keep prior output between watch reruns (`--clear-screen=false`). */
  noClearScreen(): this {
    this.#noClearScreen = true;
    return this;
  }

  /** Additional paths to watch (`--include`); repeatable, watch mode only. */
  include(...paths: PathLike[]): this {
    for (const path of paths) this.#includes.push("--include", String(path));
    return this;
  }

  /** Paths to ignore while watching (`--exclude`); repeatable, watch mode only. */
  exclude(...paths: PathLike[]): this {
    for (const path of paths) this.#excludes.push("--exclude", String(path));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("TsxTasks.run: .script() is required.");
    }
    const argv: string[] = this.#watch ? ["watch"] : [];
    if (this.#noClearScreen) argv.push("--clear-screen=false");
    argv.push(...this.#includes, ...this.#excludes);
    if (this.#tsconfig !== undefined) argv.push("--tsconfig", this.#tsconfig);
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    if (this.#noCache) argv.push("--no-cache");
    if (this.#noWarnings) argv.push("--no-warnings");
    argv.push(...this.#conditions, ...this.#imports);
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** The shape of {@link TsxTasks}. */
export interface TsxTasksApi {
  /** Run a TypeScript entry point with `tsx` (one-shot unless {@link TsxSettings.watch}). */
  run(configure?: Configure<TsxSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsx` TypeScript runner. */
export const TsxTasks: TsxTasksApi = {
  run(configure?: Configure<TsxSettings>): Promise<CommandOutput> {
    return runSettings(new TsxSettings(), configure);
  },
};
