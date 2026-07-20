/**
 * `OrvalTasks` — typed task functions for [`orval`](https://orval.dev), the
 * OpenAPI client and mock generator, in the same settings-lambda style as the
 * other Zuke tool wrappers: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * `orval` has no subcommands — the bare invocation reads an OpenAPI
 * specification (by default from `./orval.config.js`) and generates a
 * TypeScript API client and optional mocks — so the single
 * {@link OrvalTasks.generate} task matches it and exposes the common config,
 * input, and output flags. Settings may be supplied entirely on the command
 * line, entirely through a config file (`.config(...)`), or a mix of both.
 *
 * ```ts
 * import { OrvalTasks } from "jsr:@zuke/orval";
 * await OrvalTasks.generate((s) => s.config("orval.config.ts").clean());
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

/** Settings for an `orval` generation run. */
export class OrvalGenerateSettings extends ToolSettings {
  #config?: string;
  #project?: string;
  #input?: string;
  #output?: string;
  #watch = false;
  #clean = false;
  #prettier = false;
  #biome = false;
  #mock = false;

  /** The executable this settings object runs: `orval`. */
  protected override defaultTool(): string {
    return "orval";
  }

  /** Resolve the binary from `node_modules/.bin` by default — orval is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** Configuration file to load settings from (`-c`/`--config`). */
  config(value: PathLike): this {
    this.#config = String(value);
    return this;
  }

  /** Run only the named project from the config (`-p`/`--project`). */
  project(value: string): this {
    this.#project = value;
    return this;
  }

  /** OpenAPI specification to read — a file path or URL (`-i`/`--input`). */
  input(value: PathLike): this {
    this.#input = String(value);
    return this;
  }

  /** Directory the generated client is written to (`-o`/`--output`). */
  output(value: PathLike): this {
    this.#output = String(value);
    return this;
  }

  /** Regenerate on changes to the specification (`-w`/`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Remove previously generated files before writing (`--clean`). */
  clean(): this {
    this.#clean = true;
    return this;
  }

  /** Format the generated output with Prettier (`--prettier`). */
  prettier(): this {
    this.#prettier = true;
    return this;
  }

  /** Format the generated output with Biome (`--biome`). */
  biome(): this {
    this.#biome = true;
    return this;
  }

  /** Generate mocks alongside the client (`--mock`). */
  mock(): this {
    this.#mock = true;
    return this;
  }

  /** Assemble the `orval` argv from the configured flags. */
  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#project !== undefined) argv.push("--project", this.#project);
    if (this.#input !== undefined) argv.push("--input", this.#input);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#watch) argv.push("--watch");
    if (this.#clean) argv.push("--clean");
    if (this.#prettier) argv.push("--prettier");
    if (this.#biome) argv.push("--biome");
    if (this.#mock) argv.push("--mock");
    return argv;
  }
}

/** The shape of {@link OrvalTasks}. */
export interface OrvalTasksApi {
  /** Generate a TypeScript API client and mocks from an OpenAPI spec with `orval`. */
  generate(
    configure?: Configure<OrvalGenerateSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the `orval` OpenAPI client and mock generator. */
export const OrvalTasks: OrvalTasksApi = {
  generate(
    configure?: Configure<OrvalGenerateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new OrvalGenerateSettings(), configure);
  },
};
