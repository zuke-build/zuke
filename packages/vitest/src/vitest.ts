/**
 * `VitestTasks` — typed task functions for the `vitest` test runner, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * Vitest defaults to watch mode when invoked bare; this wrapper emits the
 * one-shot `run` subcommand by default (CI-friendly) and switches to `watch`
 * via {@link VitestSettings.watch}.
 *
 * ```ts
 * import { VitestTasks } from "jsr:@zuke/vitest";
 * await VitestTasks.run((s) => s.coverage().reporter("dot"));
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

/** Settings for a `vitest` run. */
export class VitestSettings extends ToolSettings {
  #filters: string[] = [];
  #watch = false;
  #config?: string;
  #root?: string;
  #dir?: string;
  #coverage = false;
  #ui = false;
  #update = false;
  #run = false;
  #bail?: number;
  #retry?: number;
  #shard?: string;
  #reporters: string[] = [];
  #outputFile?: string;
  #testNamePattern?: string;
  #environment?: string;
  #globals = false;
  #passWithNoTests = false;
  #silent = false;

  /** The underlying tool binary (`vitest`). */
  protected override defaultTool(): string {
    return "vitest";
  }

  /** Filename filters matched against test files (positional); repeatable. */
  filters(...values: string[]): this {
    this.#filters.push(...values);
    return this;
  }

  /** Use watch mode (`watch`) instead of the default one-shot `run`. */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Project root (`--root`). */
  root(path: PathLike): this {
    this.#root = String(path);
    return this;
  }

  /** Restrict the scanned directory (`--dir`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Collect test coverage (`--coverage`). */
  coverage(): this {
    this.#coverage = true;
    return this;
  }

  /** Open the Vitest UI (`--ui`). */
  ui(): this {
    this.#ui = true;
    return this;
  }

  /** Update snapshots (`-u`/`--update`). */
  update(): this {
    this.#update = true;
    return this;
  }

  /** Force one-shot mode even under watch (`--run`). */
  forceRun(): this {
    this.#run = true;
    return this;
  }

  /** Stop after N failed tests (`--bail`). */
  bail(count: number): this {
    this.#bail = count;
    return this;
  }

  /** Retry failed tests up to N times (`--retry`). */
  retry(count: number): this {
    this.#retry = count;
    return this;
  }

  /** Run a shard of the suite, e.g. `1/4` (`--shard`). */
  shard(value: string): this {
    this.#shard = value;
    return this;
  }

  /** Use the named reporters (`--reporter`); repeatable. */
  reporter(...names: string[]): this {
    for (const name of names) this.#reporters.push("--reporter", name);
    return this;
  }

  /** Write report output to a file (`--outputFile`). */
  outputFile(path: PathLike): this {
    this.#outputFile = String(path);
    return this;
  }

  /** Run only tests whose name matches the pattern (`-t`/`--testNamePattern`). */
  testNamePattern(pattern: string): this {
    this.#testNamePattern = pattern;
    return this;
  }

  /** Test environment, e.g. `jsdom`, `node` (`--environment`). */
  environment(value: string): this {
    this.#environment = value;
    return this;
  }

  /** Enable global test APIs (`--globals`). */
  globals(): this {
    this.#globals = true;
    return this;
  }

  /** Pass when no tests are found (`--passWithNoTests`). */
  passWithNoTests(): this {
    this.#passWithNoTests = true;
    return this;
  }

  /** Suppress test console output (`--silent`). */
  silent(): this {
    this.#silent = true;
    return this;
  }

  /** Assemble the `vitest run`/`vitest watch` argv. */
  protected override buildArgs(): string[] {
    const argv = [this.#watch ? "watch" : "run"];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    if (this.#root !== undefined) argv.push("--root", this.#root);
    if (this.#dir !== undefined) argv.push("--dir", this.#dir);
    if (this.#coverage) argv.push("--coverage");
    if (this.#ui) argv.push("--ui");
    if (this.#update) argv.push("-u");
    if (this.#run) argv.push("--run");
    if (this.#bail !== undefined) argv.push("--bail", String(this.#bail));
    if (this.#retry !== undefined) argv.push("--retry", String(this.#retry));
    if (this.#shard !== undefined) argv.push("--shard", this.#shard);
    argv.push(...this.#reporters);
    if (this.#outputFile !== undefined) {
      argv.push("--outputFile", this.#outputFile);
    }
    if (this.#testNamePattern !== undefined) {
      argv.push("-t", this.#testNamePattern);
    }
    if (this.#environment !== undefined) {
      argv.push("--environment", this.#environment);
    }
    if (this.#globals) argv.push("--globals");
    if (this.#passWithNoTests) argv.push("--passWithNoTests");
    if (this.#silent) argv.push("--silent");
    argv.push(...this.#filters);
    return argv;
  }
}

/** The shape of {@link VitestTasks}. */
export interface VitestTasksApi {
  /** Run tests with `vitest` (one-shot `run` unless {@link VitestSettings.watch}). */
  run(configure?: Configure<VitestSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `vitest` test runner. */
export const VitestTasks: VitestTasksApi = {
  run(configure?: Configure<VitestSettings>): Promise<CommandOutput> {
    return runSettings(new VitestSettings(), configure);
  },
};
