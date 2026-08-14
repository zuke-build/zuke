// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `StorybookTasks` — typed task functions for the
 * [Storybook](https://storybook.js.org) CLI, in the settings-lambda style:
 * configure a fluent settings object in a lambda, and the task function builds
 * the command line and executes it.
 *
 * ```ts
 * import { StorybookTasks } from "jsr:@zuke/storybook";
 * await StorybookTasks.dev((s) => s.port(6006).noOpen().ci());
 * await StorybookTasks.build((s) => s.outputDir("storybook-static"));
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
 * Base for all `storybook` subcommand settings: the binary is `storybook`,
 * with the `--config-dir` option every subcommand accepts.
 */
export abstract class StorybookSettings extends ToolSettings {
  #configDir?: string;

  /** The default binary this wrapper invokes: `storybook`. */
  protected override defaultTool(): string {
    return "storybook";
  }

  /** Resolve the binary from `node_modules/.bin` by default — Storybook is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Read the configuration from this directory instead of `.storybook` (`--config-dir`). */
  configDir(path: PathLike): this {
    this.#configDir = String(path);
    return this;
  }

  /** The shared option arguments. */
  protected baseArgs(): string[] {
    return this.#configDir === undefined
      ? []
      : ["--config-dir", this.#configDir];
  }
}

/** Settings for `storybook dev` (the development server). */
export class StorybookDevSettings extends StorybookSettings {
  #port?: number;
  #host?: string;
  #open = true;
  #ci = false;

  /** Serve on a specific port (`--port`). */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** Bind to a host/IP (`--host`). */
  host(value: string): this {
    this.#host = value;
    return this;
  }

  /** Do not open the browser on start (`--no-open`). */
  noOpen(): this {
    this.#open = false;
    return this;
  }

  /**
   * Never prompt and never open a browser (`--ci`).
   *
   * A build step is not a terminal someone is watching: without this Storybook
   * can stop on an interactive question and hang the run.
   */
  ci(): this {
    this.#ci = true;
    return this;
  }

  /** Assemble the `storybook dev` argv. */
  protected override buildArgs(): string[] {
    const argv = ["dev", ...this.baseArgs()];
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (!this.#open) argv.push("--no-open");
    if (this.#ci) argv.push("--ci");
    return argv;
  }
}

/** Settings for `storybook build` (the static build). */
export class StorybookBuildSettings extends StorybookSettings {
  #outputDir?: string;
  #quietOutput = false;

  /** Write the static build to this directory (`--output-dir`). */
  outputDir(path: PathLike): this {
    this.#outputDir = String(path);
    return this;
  }

  /**
   * Suppress the progress output, leaving warnings and errors (`--quiet`).
   *
   * Named `quietOutput` because `ToolSettings.quiet()` already means "do not
   * stream the process output to the terminal", which is a different thing.
   */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** Assemble the `storybook build` argv. */
  protected override buildArgs(): string[] {
    const argv = ["build", ...this.baseArgs()];
    if (this.#outputDir !== undefined) {
      argv.push("--output-dir", this.#outputDir);
    }
    if (this.#quietOutput) argv.push("--quiet");
    return argv;
  }
}

/** The shape of {@link StorybookTasks}. */
export interface StorybookTasksApi {
  /** Start the development server: `storybook dev`. */
  dev(configure?: Configure<StorybookDevSettings>): Promise<CommandOutput>;
  /** Build the static Storybook: `storybook build`. */
  build(configure?: Configure<StorybookBuildSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `storybook` CLI. */
export const StorybookTasks: StorybookTasksApi = {
  dev(configure?: Configure<StorybookDevSettings>): Promise<CommandOutput> {
    return runSettings(new StorybookDevSettings(), configure);
  },
  build(configure?: Configure<StorybookBuildSettings>): Promise<CommandOutput> {
    return runSettings(new StorybookBuildSettings(), configure);
  },
};
