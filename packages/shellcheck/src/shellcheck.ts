// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ShellcheckTasks` — typed task functions for the
 * [ShellCheck](https://www.shellcheck.net/) static analyser, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { ShellcheckTasks } from "jsr:@zuke/shellcheck";
 * await ShellcheckTasks.lint((s) =>
 *   s.shell("sh").severity("warning").paths("sh/lib.sh", "bin/gate")
 * );
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

/**
 * A shell dialect ShellCheck can analyse (`-s`), overriding the shebang.
 *
 * A closed set: ShellCheck rejects anything else outright, so the type does
 * the same job the settings class does — the mistake is a compile error rather
 * than a failed run.
 */
export type ShellcheckShell = "sh" | "bash" | "dash" | "ksh" | "busybox";

/** The lowest severity ShellCheck reports (`-S`). */
export type ShellcheckSeverity = "error" | "warning" | "info" | "style";

/** An output format ShellCheck can emit (`-f`). */
export type ShellcheckFormat =
  | "tty"
  | "gcc"
  | "checkstyle"
  | "diff"
  | "json"
  | "json1"
  | "quiet";

/** Settings for a `shellcheck` run. */
export class ShellcheckSettings extends ToolSettings {
  #paths: string[] = [];
  #shell?: ShellcheckShell;
  #severity?: ShellcheckSeverity;
  #format?: ShellcheckFormat;
  #excludes: string[] = [];
  #externalSources = false;

  /** The default executable name (`shellcheck`). */
  protected override defaultTool(): string {
    return "shellcheck";
  }

  /**
   * Resolve the binary from `PATH` — ShellCheck is a native binary (Haskell),
   * installed by a package manager rather than into `node_modules/.bin`.
   */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** Scripts to check (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /**
   * The dialect to analyse as (`-s`/`--shell`), overriding the shebang.
   *
   * This is the flag that makes a portability gate mean something: a script
   * with a `#!/bin/bash` shebang, or none at all, is otherwise checked as
   * bash, so the POSIX violations the gate exists to catch go unreported.
   */
  shell(dialect: ShellcheckShell): this {
    this.#shell = dialect;
    return this;
  }

  /** The lowest severity to report (`-S`/`--severity`). */
  severity(level: ShellcheckSeverity): this {
    this.#severity = level;
    return this;
  }

  /** The output format (`-f`/`--format`). */
  format(value: ShellcheckFormat): this {
    this.#format = value;
    return this;
  }

  /**
   * Suppress specific checks by code (`-e`/`--exclude`); repeatable. Codes may
   * be given with or without the `SC` prefix, as ShellCheck accepts both.
   */
  exclude(...codes: string[]): this {
    this.#excludes.push(...codes);
    return this;
  }

  /** Follow `source`d files outside the checked set (`-x`/`--external-sources`). */
  externalSources(): this {
    this.#externalSources = true;
    return this;
  }

  /** Assemble the `shellcheck` argv. */
  protected override buildArgs(): string[] {
    if (this.#paths.length === 0) {
      throw new Error(
        "ShellcheckTasks.lint: no scripts to check — add .paths('sh/lib.sh'), " +
          "or skip the task when the list a build computed came back empty. " +
          "shellcheck needs at least one file operand (`-` for stdin), so the " +
          "run would fail with its usage text instead of linting.",
      );
    }
    const argv: string[] = [];
    if (this.#shell !== undefined) argv.push("-s", this.#shell);
    if (this.#severity !== undefined) argv.push("-S", this.#severity);
    if (this.#format !== undefined) argv.push("-f", this.#format);
    // Joined with commas rather than repeated: shellcheck accepts both, and one
    // -e keeps a long suppression list readable in the argv a dry run prints.
    if (this.#excludes.length > 0) argv.push("-e", this.#excludes.join(","));
    if (this.#externalSources) argv.push("-x");
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link ShellcheckTasks}. */
export interface ShellcheckTasksApi {
  /** Analyse shell scripts with `shellcheck`. */
  lint(configure?: Configure<ShellcheckSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the ShellCheck static analyser. */
export const ShellcheckTasks: ShellcheckTasksApi = {
  lint(configure?: Configure<ShellcheckSettings>): Promise<CommandOutput> {
    return runSettings(new ShellcheckSettings(), configure);
  },
};
