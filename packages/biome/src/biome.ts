/**
 * `BiomeTasks` — typed task functions for the [Biome](https://biomejs.dev) CLI,
 * in the settings-lambda style: configure a fluent settings object in a lambda,
 * and the task function builds the command line and executes it.
 *
 * ```ts
 * import { BiomeTasks } from "jsr:@zuke/biome";
 * await BiomeTasks.ci((s) => s.paths("src"));
 * await BiomeTasks.check((s) => s.write().paths("src"));
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

/**
 * Base for all `biome` subcommand settings: the binary is `biome`, and the
 * common filters (config path, reporter, `--staged`, `--changed`) plus the
 * trailing path arguments are shared by every subcommand.
 */
abstract class BiomeSettings extends ToolSettings {
  #paths: string[] = [];
  #config?: string;
  #reporter?: string;
  #staged = false;
  #changed = false;

  protected override defaultTool(): string {
    return "biome";
  }

  /** Files or directories to operate on; omit to use the configured includes. */
  paths(...paths: PathLike[]): this {
    this.#paths.push(...paths.map(String));
    return this;
  }

  /** Use an explicit configuration file (`--config-path`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Choose the diagnostics reporter, e.g. `github` or `json` (`--reporter`). */
  reporter(name: string): this {
    this.#reporter = name;
    return this;
  }

  /** Restrict to files staged in git (`--staged`). */
  staged(): this {
    this.#staged = true;
    return this;
  }

  /** Restrict to files changed against the VCS base (`--changed`). */
  changed(): this {
    this.#changed = true;
    return this;
  }

  /** The shared flag arguments (before paths). */
  protected flagArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push(`--config-path=${this.#config}`);
    if (this.#reporter !== undefined) argv.push(`--reporter=${this.#reporter}`);
    if (this.#staged) argv.push("--staged");
    if (this.#changed) argv.push("--changed");
    return argv;
  }

  /** The trailing path arguments. */
  protected pathArgs(): string[] {
    return [...this.#paths];
  }
}

/** Settings for `biome check` (lint + format + organize-imports). */
export class BiomeCheckSettings extends BiomeSettings {
  #write = false;
  #unsafe = false;

  /** Write safe fixes back to disk (`--write`). */
  write(): this {
    this.#write = true;
    return this;
  }

  /** Also apply unsafe fixes; implies writing (`--unsafe`). */
  unsafe(): this {
    this.#unsafe = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["check", ...this.flagArgs()];
    if (this.#write) argv.push("--write");
    if (this.#unsafe) argv.push("--unsafe");
    argv.push(...this.pathArgs());
    return argv;
  }
}

/** Settings for `biome format`. */
export class BiomeFormatSettings extends BiomeSettings {
  #write = false;

  /** Write formatting changes back to disk (`--write`). */
  write(): this {
    this.#write = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["format", ...this.flagArgs()];
    if (this.#write) argv.push("--write");
    argv.push(...this.pathArgs());
    return argv;
  }
}

/** Settings for `biome lint`. */
export class BiomeLintSettings extends BiomeSettings {
  #write = false;
  #unsafe = false;

  /** Write safe lint fixes back to disk (`--write`). */
  write(): this {
    this.#write = true;
    return this;
  }

  /** Also apply unsafe fixes; implies writing (`--unsafe`). */
  unsafe(): this {
    this.#unsafe = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["lint", ...this.flagArgs()];
    if (this.#write) argv.push("--write");
    if (this.#unsafe) argv.push("--unsafe");
    argv.push(...this.pathArgs());
    return argv;
  }
}

/** Settings for `biome ci` (read-only check tuned for CI). */
export class BiomeCiSettings extends BiomeSettings {
  protected override buildArgs(): string[] {
    return ["ci", ...this.flagArgs(), ...this.pathArgs()];
  }
}

/** The shape of {@link BiomeTasks}. */
export interface BiomeTasksApi {
  /** Lint, format, and organize imports: `biome check`. */
  check(configure?: Configure<BiomeCheckSettings>): Promise<CommandOutput>;
  /** Format code: `biome format`. */
  format(configure?: Configure<BiomeFormatSettings>): Promise<CommandOutput>;
  /** Lint code: `biome lint`. */
  lint(configure?: Configure<BiomeLintSettings>): Promise<CommandOutput>;
  /** Read-only CI check: `biome ci`. */
  ci(configure?: Configure<BiomeCiSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `biome` CLI. */
export const BiomeTasks: BiomeTasksApi = {
  check(configure?: Configure<BiomeCheckSettings>): Promise<CommandOutput> {
    return runSettings(new BiomeCheckSettings(), configure);
  },
  format(configure?: Configure<BiomeFormatSettings>): Promise<CommandOutput> {
    return runSettings(new BiomeFormatSettings(), configure);
  },
  lint(configure?: Configure<BiomeLintSettings>): Promise<CommandOutput> {
    return runSettings(new BiomeLintSettings(), configure);
  },
  ci(configure?: Configure<BiomeCiSettings>): Promise<CommandOutput> {
    return runSettings(new BiomeCiSettings(), configure);
  },
};
