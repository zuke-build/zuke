/**
 * `CspellTasks` — typed task functions for the `cspell` spell-checker, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * ```ts
 * import { CspellTasks } from "jsr:@zuke/cspell";
 * await CspellTasks.lint((s) => s.files("**").noProgress().showSuggestions());
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

/** Settings for a `cspell lint` run. */
export class CspellSettings extends ToolSettings {
  #files: string[] = [];
  #config?: string;
  #noProgress = false;
  #noSummary = false;
  #showSuggestions = false;
  #showContext = false;
  #quietOutput = false;
  #cache = false;
  #dot = false;
  #gitignore = false;
  #unique = false;
  #locale?: string;
  #excludes: string[] = [];
  #maxDuplicateProblems?: number;

  /** The default executable name (`cspell`). */
  protected override defaultTool(): string {
    return "cspell";
  }

  /** Resolve the binary from `node_modules/.bin` by default — cspell is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Files or globs to check (positional); repeatable. */
  files(...globs: PathLike[]): this {
    this.#files.push(...globs.map(String));
    return this;
  }

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Suppress the progress output (`--no-progress`). */
  noProgress(): this {
    this.#noProgress = true;
    return this;
  }

  /** Suppress the summary line (`--no-summary`). */
  noSummary(): this {
    this.#noSummary = true;
    return this;
  }

  /** Print spelling suggestions for each issue (`--show-suggestions`). */
  showSuggestions(): this {
    this.#showSuggestions = true;
    return this;
  }

  /** Print the surrounding line for each issue (`--show-context`). */
  showContext(): this {
    this.#showContext = true;
    return this;
  }

  /** Only emit issues, hiding informational output (`--quiet`). */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** Cache results between runs (`--cache`). */
  cache(): this {
    this.#cache = true;
    return this;
  }

  /** Include dotfiles and dot-directories (`--dot`). */
  dot(): this {
    this.#dot = true;
    return this;
  }

  /** Honour `.gitignore` files (`--gitignore`). */
  gitignore(): this {
    this.#gitignore = true;
    return this;
  }

  /** Report each unique issue only once (`--unique`). */
  unique(): this {
    this.#unique = true;
    return this;
  }

  /** Restrict to a locale, e.g. `en,en-GB` (`--locale`). */
  locale(value: string): this {
    this.#locale = value;
    return this;
  }

  /** Exclude files matching a glob (`-e`/`--exclude`); repeatable. */
  exclude(glob: string): this {
    this.#excludes.push("-e", glob);
    return this;
  }

  /** Cap the number of duplicate problems reported (`--max-duplicate-problems`). */
  maxDuplicateProblems(count: number): this {
    this.#maxDuplicateProblems = count;
    return this;
  }

  /** Assemble the `cspell lint` argv. */
  protected override buildArgs(): string[] {
    const argv = ["lint"];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    if (this.#noProgress) argv.push("--no-progress");
    if (this.#noSummary) argv.push("--no-summary");
    if (this.#showSuggestions) argv.push("--show-suggestions");
    if (this.#showContext) argv.push("--show-context");
    if (this.#quietOutput) argv.push("--quiet");
    if (this.#cache) argv.push("--cache");
    if (this.#dot) argv.push("--dot");
    if (this.#gitignore) argv.push("--gitignore");
    if (this.#unique) argv.push("--unique");
    if (this.#locale !== undefined) argv.push("--locale", this.#locale);
    argv.push(...this.#excludes);
    if (this.#maxDuplicateProblems !== undefined) {
      argv.push("--max-duplicate-problems", String(this.#maxDuplicateProblems));
    }
    argv.push(...this.#files);
    return argv;
  }
}

/** The shape of {@link CspellTasks}. */
export interface CspellTasksApi {
  /** Spell-check with `cspell lint`. */
  lint(configure?: Configure<CspellSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `cspell` spell-checker. */
export const CspellTasks: CspellTasksApi = {
  lint(configure?: Configure<CspellSettings>): Promise<CommandOutput> {
    return runSettings(new CspellSettings(), configure);
  },
};
