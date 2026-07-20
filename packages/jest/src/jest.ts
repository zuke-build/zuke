/**
 * `JestTasks` — typed task functions for the `jest` test runner, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { JestTasks } from "jsr:@zuke/jest";
 * await JestTasks.run((s) => s.ci().coverage().maxWorkers(2));
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

/** Settings for a `jest` run. */
export class JestSettings extends ToolSettings {
  #patterns: string[] = [];
  #config?: string;
  #coverage = false;
  #watch = false;
  #watchAll = false;
  #ci = false;
  #runInBand = false;
  #maxWorkers?: string;
  #updateSnapshot = false;
  #bail?: number;
  #verbose = false;
  #silent = false;
  #testNamePattern?: string;
  #onlyChanged = false;
  #passWithNoTests = false;
  #detectOpenHandles = false;
  #selectProjects: string[] = [];
  #reporters: string[] = [];

  /** The underlying tool binary is `jest`. */
  protected override defaultTool(): string {
    return "jest";
  }

  /** Regex patterns matched against test paths (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#patterns.push(...values.map(String));
    return this;
  }

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Collect test coverage (`--coverage`). */
  coverage(): this {
    this.#coverage = true;
    return this;
  }

  /** Watch files related to changed files (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Watch all files (`--watchAll`). */
  watchAll(): this {
    this.#watchAll = true;
    return this;
  }

  /** Run in CI mode, failing on new snapshots (`--ci`). */
  ci(): this {
    this.#ci = true;
    return this;
  }

  /** Run all tests serially in the current process (`-i`/`--runInBand`). */
  runInBand(): this {
    this.#runInBand = true;
    return this;
  }

  /** Limit worker count, e.g. `2` or `50%` (`--maxWorkers`). */
  maxWorkers(value: string | number): this {
    this.#maxWorkers = String(value);
    return this;
  }

  /** Re-record snapshots (`-u`/`--updateSnapshot`). */
  updateSnapshot(): this {
    this.#updateSnapshot = true;
    return this;
  }

  /** Stop after N failing test suites (`--bail`). */
  bail(suites = 1): this {
    this.#bail = suites;
    return this;
  }

  /** Report each individual test (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Prevent tests from printing to the console (`--silent`). */
  silent(): this {
    this.#silent = true;
    return this;
  }

  /** Run only tests whose name matches the pattern (`-t`/`--testNamePattern`). */
  testNamePattern(pattern: string): this {
    this.#testNamePattern = pattern;
    return this;
  }

  /** Run only tests affected by changed files (`-o`/`--onlyChanged`). */
  onlyChanged(): this {
    this.#onlyChanged = true;
    return this;
  }

  /** Pass when no tests are found (`--passWithNoTests`). */
  passWithNoTests(): this {
    this.#passWithNoTests = true;
    return this;
  }

  /** Detect handles keeping the process open (`--detectOpenHandles`). */
  detectOpenHandles(): this {
    this.#detectOpenHandles = true;
    return this;
  }

  /** Restrict to named projects (`--selectProjects`); repeatable. */
  selectProjects(...names: string[]): this {
    this.#selectProjects.push(...names);
    return this;
  }

  /** Use the named reporters (`--reporters`); repeatable. */
  reporters(...names: string[]): this {
    this.#reporters.push(...names);
    return this;
  }

  /** Assemble the `jest` argv from the configured flags and patterns. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    if (this.#coverage) argv.push("--coverage");
    if (this.#watch) argv.push("--watch");
    if (this.#watchAll) argv.push("--watchAll");
    if (this.#ci) argv.push("--ci");
    if (this.#runInBand) argv.push("-i");
    if (this.#maxWorkers !== undefined) {
      argv.push("--maxWorkers", this.#maxWorkers);
    }
    if (this.#updateSnapshot) argv.push("-u");
    if (this.#bail !== undefined) argv.push("--bail", String(this.#bail));
    if (this.#verbose) argv.push("--verbose");
    if (this.#silent) argv.push("--silent");
    if (this.#testNamePattern !== undefined) {
      argv.push("-t", this.#testNamePattern);
    }
    if (this.#onlyChanged) argv.push("-o");
    if (this.#passWithNoTests) argv.push("--passWithNoTests");
    if (this.#detectOpenHandles) argv.push("--detectOpenHandles");
    // Array flags use `--flag=value` form so jest's yargs parser binds exactly
    // one value per flag; the space-separated form is greedy and swallows the
    // trailing positional test-path patterns into the array instead.
    for (const p of this.#selectProjects) argv.push(`--selectProjects=${p}`);
    for (const r of this.#reporters) argv.push(`--reporters=${r}`);
    argv.push(...this.#patterns);
    return argv;
  }
}

/** The shape of {@link JestTasks}. */
export interface JestTasksApi {
  /** Run tests with `jest`. */
  run(configure?: Configure<JestSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `jest` test runner. */
export const JestTasks: JestTasksApi = {
  run(configure?: Configure<JestSettings>): Promise<CommandOutput> {
    return runSettings(new JestSettings(), configure);
  },
};
