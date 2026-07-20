/**
 * `OxlintTasks` — typed task functions for the `oxlint` linter, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { OxlintTasks } from "jsr:@zuke/oxlint";
 * await OxlintTasks.lint((s) => s.paths("src").fix().denyWarnings());
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

/** Settings for an `oxlint` run. */
export class OxlintSettings extends ToolSettings {
  #paths: string[] = [];
  #config?: string;
  #tsconfig?: string;
  #fix = false;
  #fixSuggestions = false;
  #rules: string[] = [];
  #ignorePath?: string;
  #ignorePatterns: string[] = [];
  #maxWarnings?: number;
  #quietWarnings = false;
  #denyWarnings = false;
  #format?: string;
  #threads?: number;

  /** The default executable name (`oxlint`). */
  protected override defaultTool(): string {
    return "oxlint";
  }

  /** Files or directories to lint (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Point at a `tsconfig.json` for type-aware rules (`--tsconfig`). */
  tsconfig(path: PathLike): this {
    this.#tsconfig = String(path);
    return this;
  }

  /** Apply automatic fixes (`--fix`). */
  fix(): this {
    this.#fix = true;
    return this;
  }

  /** Apply suggestion fixes too (`--fix-suggestions`). */
  fixSuggestions(): this {
    this.#fixSuggestions = true;
    return this;
  }

  /** Raise a rule or category to error (`-D`/`--deny`); repeatable. */
  deny(rule: string): this {
    this.#rules.push("-D", rule);
    return this;
  }

  /** Set a rule or category to warning (`-W`/`--warn`); repeatable. */
  warn(rule: string): this {
    this.#rules.push("-W", rule);
    return this;
  }

  /** Turn a rule or category off (`-A`/`--allow`); repeatable. */
  allow(rule: string): this {
    this.#rules.push("-A", rule);
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

  /** Fail once this many warnings are reached (`--max-warnings`). */
  maxWarnings(count: number): this {
    this.#maxWarnings = count;
    return this;
  }

  /** Report errors only, suppressing warnings (`--quiet`). */
  quietWarnings(): this {
    this.#quietWarnings = true;
    return this;
  }

  /** Exit non-zero if any warnings are found (`--deny-warnings`). */
  denyWarnings(): this {
    this.#denyWarnings = true;
    return this;
  }

  /** Output format, e.g. `default`, `json`, `github` (`-f`/`--format`). */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Number of threads to use (`--threads`). */
  threads(count: number): this {
    this.#threads = count;
    return this;
  }

  /** Assemble the `oxlint` argv from the configured settings. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    if (this.#tsconfig !== undefined) argv.push("--tsconfig", this.#tsconfig);
    if (this.#fix) argv.push("--fix");
    if (this.#fixSuggestions) argv.push("--fix-suggestions");
    argv.push(...this.#rules);
    if (this.#ignorePath !== undefined) {
      argv.push("--ignore-path", this.#ignorePath);
    }
    argv.push(...this.#ignorePatterns);
    if (this.#maxWarnings !== undefined) {
      argv.push("--max-warnings", String(this.#maxWarnings));
    }
    if (this.#quietWarnings) argv.push("--quiet");
    if (this.#denyWarnings) argv.push("--deny-warnings");
    if (this.#format !== undefined) argv.push("-f", this.#format);
    if (this.#threads !== undefined) {
      argv.push("--threads", String(this.#threads));
    }
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link OxlintTasks}. */
export interface OxlintTasksApi {
  /** Lint with `oxlint`. */
  lint(configure?: Configure<OxlintSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `oxlint` linter. */
export const OxlintTasks: OxlintTasksApi = {
  lint(configure?: Configure<OxlintSettings>): Promise<CommandOutput> {
    return runSettings(new OxlintSettings(), configure);
  },
};
