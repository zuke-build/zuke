// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `RedoclyTasks` — typed task functions for the
 * [Redocly CLI](https://redocly.com/docs/cli), in the settings-lambda style:
 * configure a fluent settings object in a lambda, and the task function builds
 * the command line and executes it.
 *
 * ```ts
 * import { RedoclyTasks } from "jsr:@zuke/redocly";
 * await RedoclyTasks.lint((s) => s.paths("openapi.yaml").skipRule("no-empty-servers"));
 * await RedoclyTasks.bundle((s) => s.paths("openapi.yaml").output("dist/openapi.yaml"));
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
 * Base for all `redocly` subcommand settings: the binary is `redocly`, with
 * the `--config` option every subcommand accepts.
 */
export abstract class RedoclySettings extends ToolSettings {
  #config?: string;

  /** The default binary this wrapper invokes: `redocly`. */
  protected override defaultTool(): string {
    return "redocly";
  }

  /** Resolve the binary from `node_modules/.bin` by default — Redocly CLI is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Use an explicit config file (`--config`) instead of the discovered `redocly.yaml`. */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** The shared option arguments. */
  protected baseArgs(): string[] {
    return this.#config === undefined ? [] : ["--config", this.#config];
  }
}

/** The output format of a `redocly lint` run (`--format`). */
export type RedoclyLintFormat =
  | "codeframe"
  | "stylish"
  | "json"
  | "checkstyle"
  | "markdown"
  | "summary";

/** Settings for `redocly lint`. */
export class RedoclyLintSettings extends RedoclySettings {
  #paths: string[] = [];
  #skipRules: string[] = [];
  #format?: RedoclyLintFormat;

  /** The API descriptions to lint — paths or aliases from the config (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /**
   * Skip a rule for this run (`--skip-rule`); repeatable.
   *
   * Use it for a rule the description cannot satisfy yet, so the rest of the
   * ruleset still gates the build instead of the whole lint being turned off.
   */
  skipRule(...rules: string[]): this {
    this.#skipRules.push(...rules);
    return this;
  }

  /** Select the output format (`--format`). */
  format(value: RedoclyLintFormat): this {
    this.#format = value;
    return this;
  }

  /** Assemble the `redocly lint` argv. */
  protected override buildArgs(): string[] {
    const argv = ["lint", ...this.baseArgs()];
    for (const rule of this.#skipRules) argv.push("--skip-rule", rule);
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `redocly bundle`. */
export class RedoclyBundleSettings extends RedoclySettings {
  #paths: string[] = [];
  #output?: string;
  #dereferenced = false;
  #ext?: string;

  /** The API descriptions to bundle — paths or aliases from the config (positional); repeatable. */
  paths(...values: PathLike[]): this {
    this.#paths.push(...values.map(String));
    return this;
  }

  /** Write the bundle to this file or directory (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Inline every `$ref` instead of keeping the components (`--dereferenced`). */
  dereferenced(): this {
    this.#dereferenced = true;
    return this;
  }

  /** The output file extension, `json`, `yaml`, or `yml` (`--ext`). */
  ext(value: "json" | "yaml" | "yml"): this {
    this.#ext = value;
    return this;
  }

  /** Assemble the `redocly bundle` argv. */
  protected override buildArgs(): string[] {
    const argv = ["bundle", ...this.baseArgs()];
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#dereferenced) argv.push("--dereferenced");
    if (this.#ext !== undefined) argv.push("--ext", this.#ext);
    argv.push(...this.#paths);
    return argv;
  }
}

/** Settings for `redocly split`. */
export class RedoclySplitSettings extends RedoclySettings {
  #api?: string;
  #outDir?: string;
  #separator?: string;

  /** The API description to split into a multi-file structure (positional; required). */
  api(path: PathLike): this {
    this.#api = String(path);
    return this;
  }

  /** The directory the split files are written to (`--outDir`; required). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** The separator used in the generated path item file names (`--separator`). */
  separator(value: string): this {
    this.#separator = value;
    return this;
  }

  /** Assemble the `redocly split` argv. */
  protected override buildArgs(): string[] {
    if (this.#api === undefined) {
      throw new Error("RedoclyTasks.split: .api() is required.");
    }
    if (this.#outDir === undefined) {
      throw new Error("RedoclyTasks.split: .outDir() is required.");
    }
    const argv = ["split", ...this.baseArgs(), this.#api];
    argv.push("--outDir", this.#outDir);
    if (this.#separator !== undefined) {
      argv.push("--separator", this.#separator);
    }
    return argv;
  }
}

/** The shape of {@link RedoclyTasks}. */
export interface RedoclyTasksApi {
  /** Lint API descriptions: `redocly lint`. */
  lint(configure?: Configure<RedoclyLintSettings>): Promise<CommandOutput>;
  /** Bundle an API description into one file: `redocly bundle`. */
  bundle(configure?: Configure<RedoclyBundleSettings>): Promise<CommandOutput>;
  /** Split an API description into a multi-file structure: `redocly split`. */
  split(configure?: Configure<RedoclySplitSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `redocly` CLI. */
export const RedoclyTasks: RedoclyTasksApi = {
  lint(configure?: Configure<RedoclyLintSettings>): Promise<CommandOutput> {
    return runSettings(new RedoclyLintSettings(), configure);
  },
  bundle(configure?: Configure<RedoclyBundleSettings>): Promise<CommandOutput> {
    return runSettings(new RedoclyBundleSettings(), configure);
  },
  split(configure?: Configure<RedoclySplitSettings>): Promise<CommandOutput> {
    return runSettings(new RedoclySplitSettings(), configure);
  },
};
