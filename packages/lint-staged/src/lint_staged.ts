// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `LintStagedTasks` — typed task functions for
 * [lint-staged](https://github.com/lint-staged/lint-staged), in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { LintStagedTasks } from "jsr:@zuke/lint-staged";
 * await LintStagedTasks.run((s) => s.config(".lintstagedrc.json").relative());
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

/** Settings for a `lint-staged` run. */
export class LintStagedSettings extends ToolSettings {
  #config?: string;
  #relative = false;
  #concurrent?: number;
  #allowEmpty = false;
  #diff?: string;
  #shell = false;

  /** The default executable name (`lint-staged`). */
  protected override defaultTool(): string {
    return "lint-staged";
  }

  /** Resolve the binary from `node_modules/.bin` by default — lint-staged is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /**
   * Pass file paths relative to the working directory rather than absolute
   * (`--relative`).
   *
   * Tools configured with root-relative globs — the usual case for an ESLint or
   * Prettier config committed at the repo root — only match when the paths
   * handed to them are relative too.
   */
  relative(): this {
    this.#relative = true;
    return this;
  }

  /**
   * Run at most `tasks` linter tasks at once (`--concurrent <n>`). Use `1` to
   * serialise them — what a tool that writes shared state (a cache, a lockfile)
   * needs.
   */
  concurrent(tasks: number): this {
    this.#concurrent = tasks;
    return this;
  }

  /**
   * Exit successfully when the tasks left nothing staged (`--allow-empty`).
   *
   * Without it a formatter that reverts the only staged change fails the run,
   * because the resulting commit would be empty.
   */
  allowEmpty(): this {
    this.#allowEmpty = true;
    return this;
  }

  /**
   * Take the file list from a diff instead of the staged files
   * (`--diff <ref>`), e.g. `main...HEAD` to lint everything a branch touched.
   */
  diff(ref: string): this {
    this.#diff = ref;
    return this;
  }

  /** Run the configured commands through a shell instead of parsing them (`--shell`). */
  shell(): this {
    this.#shell = true;
    return this;
  }

  /** Assemble the `lint-staged` argv. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#relative) argv.push("--relative");
    if (this.#concurrent !== undefined) {
      argv.push("--concurrent", String(this.#concurrent));
    }
    if (this.#allowEmpty) argv.push("--allow-empty");
    if (this.#diff !== undefined) argv.push("--diff", this.#diff);
    if (this.#shell) argv.push("--shell");
    return argv;
  }
}

/** The shape of {@link LintStagedTasks}. */
export interface LintStagedTasksApi {
  /** Run the configured linters over the staged files: `lint-staged`. */
  run(configure?: Configure<LintStagedSettings>): Promise<CommandOutput>;
}

/** Typed task functions for `lint-staged`. */
export const LintStagedTasks: LintStagedTasksApi = {
  run(configure?: Configure<LintStagedSettings>): Promise<CommandOutput> {
    return runSettings(new LintStagedSettings(), configure);
  },
};
