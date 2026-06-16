/**
 * `TsxTasks` — typed task functions for the `tsx` TypeScript runner, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * The task names mirror the `tsx` CLI: {@link TsxTasks.tsx} runs an entry point
 * (`tsx <file>`) and {@link TsxTasks.watch} re-runs it on changes
 * (`tsx watch <file>`).
 *
 * ```ts
 * import { TsxTasks } from "jsr:@zuke/tsx";
 * await TsxTasks.tsx((s) => s.script("src/main.ts").tsconfig("tsconfig.json"));
 * await TsxTasks.watch((s) => s.script("src/main.ts").noClearScreen());
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

/** Options shared by every `tsx` invocation: the entry point and how to load it. */
abstract class TsxCommonSettings extends ToolSettings {
  #script?: string;
  #scriptArgs: string[] = [];
  #tsconfig?: string;
  #envFile?: string;
  #noCache = false;
  #noWarnings = false;
  #conditions: string[] = [];
  #imports: string[] = [];

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

  /** The option flags, then the required entry point and its arguments. */
  protected entryArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("@zuke/tsx: .script() is required.");
    }
    const argv: string[] = [];
    if (this.#tsconfig !== undefined) argv.push("--tsconfig", this.#tsconfig);
    if (this.#envFile !== undefined) argv.push(`--env-file=${this.#envFile}`);
    if (this.#noCache) argv.push("--no-cache");
    if (this.#noWarnings) argv.push("--no-warnings");
    argv.push(...this.#conditions, ...this.#imports);
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `tsx <file>`. */
export class TsxSettings extends TsxCommonSettings {
  protected override buildArgs(): string[] {
    return this.entryArgs();
  }
}

/** Settings for `tsx watch <file>`. */
export class TsxWatchSettings extends TsxCommonSettings {
  #noClearScreen = false;
  #includes: string[] = [];
  #excludes: string[] = [];

  /** Keep prior output between reruns (`--clear-screen=false`). */
  noClearScreen(): this {
    this.#noClearScreen = true;
    return this;
  }

  /** Additional paths to watch (`--include`); repeatable. */
  include(...paths: PathLike[]): this {
    for (const path of paths) this.#includes.push("--include", String(path));
    return this;
  }

  /** Paths to ignore while watching (`--exclude`); repeatable. */
  exclude(...paths: PathLike[]): this {
    for (const path of paths) this.#excludes.push("--exclude", String(path));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["watch"];
    if (this.#noClearScreen) argv.push("--clear-screen=false");
    argv.push(...this.#includes, ...this.#excludes);
    argv.push(...this.entryArgs());
    return argv;
  }
}

/** The shape of {@link TsxTasks}. */
export interface TsxTasksApi {
  /** Run a TypeScript entry point: `tsx <file>`. */
  tsx(configure?: Configure<TsxSettings>): Promise<CommandOutput>;
  /** Re-run an entry point on changes: `tsx watch <file>`. */
  watch(configure?: Configure<TsxWatchSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `tsx` TypeScript runner. */
export const TsxTasks: TsxTasksApi = {
  /** Run a TypeScript entry point: `tsx <file>`. */
  tsx(configure?: Configure<TsxSettings>): Promise<CommandOutput> {
    return runSettings(new TsxSettings(), configure);
  },
  /** Re-run an entry point on changes: `tsx watch <file>`. */
  watch(configure?: Configure<TsxWatchSettings>): Promise<CommandOutput> {
    return runSettings(new TsxWatchSettings(), configure);
  },
};
