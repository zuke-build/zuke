/**
 * `OpenapiTsTasks` — typed task functions for `openapi-ts`, the
 * [Hey API](https://heyapi.dev) code generator (`@hey-api/openapi-ts`), in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * `openapi-ts` has no subcommands — the bare invocation reads an OpenAPI
 * specification and generates a type-safe client — so the single
 * {@link OpenapiTsTasks.generate} task matches it and exposes the common input,
 * output, and client flags. Settings may be supplied entirely on the command
 * line, entirely through a config file (`.file(...)`), or a mix of both.
 *
 * ```ts
 * import { OpenapiTsTasks } from "jsr:@zuke/openapi-ts";
 * await OpenapiTsTasks.generate((s) =>
 *   s.input("openapi.yaml").output("src/client").client("@hey-api/client-fetch")
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
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for an `openapi-ts` generation run. */
export class OpenapiTsGenerateSettings extends ToolSettings {
  #input?: string;
  #output?: string;
  #client?: string;
  #file?: string;
  #dryRun = false;
  #watch = false;
  #silent = false;

  protected override defaultTool(): string {
    return "openapi-ts";
  }

  /** OpenAPI specification to read — a file path or URL (`--input`). */
  input(value: PathLike): this {
    this.#input = String(value);
    return this;
  }

  /** Directory the generated client is written to (`--output`). */
  output(value: PathLike): this {
    this.#output = String(value);
    return this;
  }

  /** HTTP client to generate for, e.g. `@hey-api/client-fetch` (`--client`). */
  client(value: string): this {
    this.#client = value;
    return this;
  }

  /** Configuration file to load settings from (`--file`). */
  file(value: PathLike): this {
    this.#file = String(value);
    return this;
  }

  /** Print the planned output without writing any files (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Regenerate on changes to the specification (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Suppress informational logging (`--silent`). */
  silent(): this {
    this.#silent = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#input !== undefined) argv.push("--input", this.#input);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#client !== undefined) argv.push("--client", this.#client);
    if (this.#file !== undefined) argv.push("--file", this.#file);
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#watch) argv.push("--watch");
    if (this.#silent) argv.push("--silent");
    return argv;
  }
}

/** The shape of {@link OpenapiTsTasks}. */
export interface OpenapiTsTasksApi {
  /** Generate a type-safe API client from an OpenAPI spec with `openapi-ts`. */
  generate(
    configure?: Configure<OpenapiTsGenerateSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the Hey API `openapi-ts` code generator. */
export const OpenapiTsTasks: OpenapiTsTasksApi = {
  generate(
    configure?: Configure<OpenapiTsGenerateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new OpenapiTsGenerateSettings(), configure);
  },
};
