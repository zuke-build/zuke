/**
 * `TurboTasks` — typed task functions for the [Turborepo](https://turbo.build)
 * CLI, in the settings-lambda style: configure a fluent settings object in a
 * lambda, and the task function builds the command line and executes it.
 *
 * ```ts
 * import { TurboTasks } from "jsr:@zuke/turbo";
 * await TurboTasks.run((s) => s.tasks("build", "test").filter("web").parallel());
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

/** Base for all `turbo` subcommand settings: the binary is `turbo`. */
export abstract class TurboSettings extends ToolSettings {
  /** The tool binary this settings class invokes: `turbo`. */
  protected override defaultTool(): string {
    return "turbo";
  }

  /** Resolve the binary from `node_modules/.bin` by default — turbo is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }
}

/** Settings for `turbo run`. */
export class TurboRunSettings extends TurboSettings {
  #tasks: string[] = [];
  #filters: string[] = [];
  #parallel = false;
  #concurrency?: string;
  #force = false;
  #noCache = false;
  #continue = false;
  #dryRun = false;
  #outputLogs?: string;

  /** The package.json task(s) to run (positional; at least one required). */
  tasks(...names: string[]): this {
    this.#tasks.push(...names);
    return this;
  }

  /** Restrict to matching packages (`--filter`); repeatable. */
  filter(pattern: string): this {
    this.#filters.push(pattern);
    return this;
  }

  /** Run tasks in parallel, ignoring dependencies (`--parallel`). */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Limit concurrency, e.g. `10` or `50%` (`--concurrency`). */
  concurrency(value: string): this {
    this.#concurrency = value;
    return this;
  }

  /** Ignore cache hits and force execution (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Disable reading and writing the cache (`--no-cache`). */
  noCache(): this {
    this.#noCache = true;
    return this;
  }

  /** Continue running tasks even after one fails (`--continue`). */
  continue(): this {
    this.#continue = true;
    return this;
  }

  /** List what would run without executing (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Output-log mode, e.g. `full`, `hash-only`, `errors-only` (`--output-logs`). */
  outputLogs(mode: string): this {
    this.#outputLogs = mode;
    return this;
  }

  /** Assemble the `turbo run` argv. */
  protected override buildArgs(): string[] {
    if (this.#tasks.length === 0) {
      throw new Error(
        "TurboTasks.run: .tasks(...) requires at least one task.",
      );
    }
    const argv = ["run", ...this.#tasks];
    for (const f of this.#filters) argv.push(`--filter=${f}`);
    if (this.#parallel) argv.push("--parallel");
    if (this.#concurrency !== undefined) {
      argv.push(`--concurrency=${this.#concurrency}`);
    }
    if (this.#force) argv.push("--force");
    if (this.#noCache) argv.push("--no-cache");
    if (this.#continue) argv.push("--continue");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#outputLogs !== undefined) {
      argv.push(`--output-logs=${this.#outputLogs}`);
    }
    return argv;
  }
}

/** Settings for `turbo prune`. */
export class TurboPruneSettings extends TurboSettings {
  #package?: string;
  #docker = false;
  #outDir?: string;

  /** The package to prune the workspace down to (required). */
  package(name: string): this {
    this.#package = name;
    return this;
  }

  /** Produce a Docker-friendly layout (`--docker`). */
  docker(): this {
    this.#docker = true;
    return this;
  }

  /** Output directory (`--out-dir`). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** Assemble the `turbo prune` argv. */
  protected override buildArgs(): string[] {
    if (this.#package === undefined) {
      throw new Error("TurboTasks.prune: .package() is required.");
    }
    const argv = ["prune", this.#package];
    if (this.#docker) argv.push("--docker");
    if (this.#outDir !== undefined) argv.push(`--out-dir=${this.#outDir}`);
    return argv;
  }
}

/** The shape of {@link TurboTasks}. */
export interface TurboTasksApi {
  /** Run workspace tasks: `turbo run`. */
  run(configure?: Configure<TurboRunSettings>): Promise<CommandOutput>;
  /** Prune the workspace to a package: `turbo prune`. */
  prune(configure?: Configure<TurboPruneSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `turbo` CLI. */
export const TurboTasks: TurboTasksApi = {
  run(configure?: Configure<TurboRunSettings>): Promise<CommandOutput> {
    return runSettings(new TurboRunSettings(), configure);
  },
  prune(configure?: Configure<TurboPruneSettings>): Promise<CommandOutput> {
    return runSettings(new TurboPruneSettings(), configure);
  },
};
