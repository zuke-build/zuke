/**
 * `KnipTasks` — a typed task function for the [Knip](https://knip.dev) CLI,
 * which finds unused files, dependencies, and exports. Settings-lambda style:
 * configure a fluent settings object in a lambda, and the task builds the
 * command line and executes it.
 *
 * Knip is a single-command tool; {@link KnipTasks.run} maps to `knip <flags>`.
 *
 * ```ts
 * import { KnipTasks } from "jsr:@zuke/knip";
 * await KnipTasks.run((s) => s.production().strict());
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

/** Settings for a `knip` run. */
export class KnipRunSettings extends ToolSettings {
  #production = false;
  #strict = false;
  #fix = false;
  #cache = false;
  #noExitCode = false;
  #config?: string;
  #workspace?: string;
  #reporter?: string;
  #include: string[] = [];

  /** The underlying CLI command: `knip`. */
  protected override defaultTool(): string {
    return "knip";
  }

  /** Restrict analysis to production code paths (`--production`). */
  production(): this {
    this.#production = true;
    return this;
  }

  /** Treat the production set strictly (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  /** Auto-remove unused exports/dependencies where possible (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Enable the analysis cache (`--cache`). */
  cache(): this {
    this.#cache = true;
    return this;
  }

  /** Always exit 0, even when issues are found (`--no-exit-code`). */
  noExitCode(): this {
    this.#noExitCode = true;
    return this;
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Restrict to a single workspace (`--workspace`). */
  workspace(name: string): this {
    this.#workspace = name;
    return this;
  }

  /** Choose the reporter, e.g. `json` or `compact` (`--reporter`). */
  reporter(name: string): this {
    this.#reporter = name;
    return this;
  }

  /** Limit to specific issue types, e.g. `files`, `dependencies` (`--include`). */
  include(...types: string[]): this {
    this.#include.push(...types);
    return this;
  }

  /** Assemble the `knip <flags>` argv. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#production) argv.push("--production");
    if (this.#strict) argv.push("--strict");
    if (this.#fix) argv.push("--fix");
    if (this.#cache) argv.push("--cache");
    if (this.#noExitCode) argv.push("--no-exit-code");
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#workspace !== undefined) {
      argv.push("--workspace", this.#workspace);
    }
    if (this.#reporter !== undefined) argv.push("--reporter", this.#reporter);
    if (this.#include.length > 0) {
      argv.push("--include", this.#include.join(","));
    }
    return argv;
  }
}

/** The shape of {@link KnipTasks}. */
export interface KnipTasksApi {
  /** Find unused files, dependencies, and exports: `knip`. */
  run(configure?: Configure<KnipRunSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `knip` CLI. */
export const KnipTasks: KnipTasksApi = {
  run(configure?: Configure<KnipRunSettings>): Promise<CommandOutput> {
    return runSettings(new KnipRunSettings(), configure);
  },
};
