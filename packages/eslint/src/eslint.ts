/**
 * `EslintTasks` — typed task functions for the `eslint` linter, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { EslintTasks } from "jsr:@zuke/eslint";
 * await EslintTasks.lint((s) => s.paths("src").ext(".ts", ".tsx").fix());
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

/** Settings for an `eslint` run. */
export class EslintSettings extends ToolSettings {
  #paths: string[] = [];
  #config?: string;
  #exts: string[] = [];
  #fix = false;
  #fixDryRun = false;
  #fixTypes: string[] = [];
  #quietWarnings = false;
  #maxWarnings?: number;
  #format?: string;
  #outputFile?: string;
  #cache = false;
  #cacheLocation?: string;
  #ignorePath?: string;
  #ignorePatterns: string[] = [];
  #noIgnore = false;
  #noConfigLookup = false;
  #reportUnusedDisableDirectives = false;

  /** The default executable this settings object runs (`eslint`). */
  protected override defaultTool(): string {
    return "eslint";
  }

  /** Resolve the binary from `node_modules/.bin` by default — eslint is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Files, directories, or globs to lint (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Additional file extensions to lint (`--ext`); repeatable. */
  ext(...extensions: string[]): this {
    for (const extension of extensions) this.#exts.push("--ext", extension);
    return this;
  }

  /** Apply automatic fixes (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Compute fixes without writing them (`--fix-dry-run`). */
  fixDryRun(): this {
    this.#fixDryRun = true;
    return this;
  }

  /** Restrict fixes to the given types (`--fix-type`); repeatable. */
  fixType(...types: string[]): this {
    for (const type of types) this.#fixTypes.push("--fix-type", type);
    return this;
  }

  /** Report errors only, suppressing warnings (`--quiet`). */
  quietWarnings(): this {
    this.#quietWarnings = true;
    return this;
  }

  /** Fail once this many warnings are reached (`--max-warnings`). */
  maxWarnings(count: number): this {
    this.#maxWarnings = count;
    return this;
  }

  /** Output format, e.g. `stylish`, `json` (`-f`/`--format`). */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Write the report to a file (`-o`/`--output-file`). */
  outputFile(path: PathLike): this {
    this.#outputFile = String(path);
    return this;
  }

  /** Cache results between runs (`--cache`). */
  cache(): this {
    this.#cache = true;
    return this;
  }

  /** Where to store the cache (`--cache-location`). */
  cacheLocation(path: PathLike): this {
    this.#cacheLocation = String(path);
    return this;
  }

  /** Read ignore globs from a file (`--ignore-path`). */
  ignorePath(path: PathLike): this {
    this.#ignorePath = String(path);
    return this;
  }

  /** Ignore files matching a glob (`--ignore-pattern`); repeatable. */
  ignorePattern(glob: string): this {
    this.#ignorePatterns.push("--ignore-pattern", glob);
    return this;
  }

  /** Disable all ignore handling (`--no-ignore`). */
  noIgnore(): this {
    this.#noIgnore = true;
    return this;
  }

  /** Do not search for a config file (`--no-config-lookup`). */
  noConfigLookup(): this {
    this.#noConfigLookup = true;
    return this;
  }

  /** Report unused `eslint-disable` directives (`--report-unused-disable-directives`). */
  reportUnusedDisableDirectives(): this {
    this.#reportUnusedDisableDirectives = true;
    return this;
  }

  /** Assemble the `eslint` argv from the configured settings. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    argv.push(...this.#exts);
    if (this.#fix) argv.push("--fix");
    if (this.#fixDryRun) argv.push("--fix-dry-run");
    argv.push(...this.#fixTypes);
    if (this.#quietWarnings) argv.push("--quiet");
    if (this.#maxWarnings !== undefined) {
      argv.push("--max-warnings", String(this.#maxWarnings));
    }
    if (this.#format !== undefined) argv.push("-f", this.#format);
    if (this.#outputFile !== undefined) argv.push("-o", this.#outputFile);
    if (this.#cache) argv.push("--cache");
    if (this.#cacheLocation !== undefined) {
      argv.push("--cache-location", this.#cacheLocation);
    }
    if (this.#ignorePath !== undefined) {
      argv.push("--ignore-path", this.#ignorePath);
    }
    argv.push(...this.#ignorePatterns);
    if (this.#noIgnore) argv.push("--no-ignore");
    if (this.#noConfigLookup) argv.push("--no-config-lookup");
    if (this.#reportUnusedDisableDirectives) {
      argv.push("--report-unused-disable-directives");
    }
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link EslintTasks}. */
export interface EslintTasksApi {
  /** Lint with `eslint`. */
  lint(configure?: Configure<EslintSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `eslint` linter. */
export const EslintTasks: EslintTasksApi = {
  lint(configure?: Configure<EslintSettings>): Promise<CommandOutput> {
    return runSettings(new EslintSettings(), configure);
  },
};
