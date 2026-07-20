/**
 * `DprintTasks` — typed task functions for the `dprint` code formatter, in the
 * same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * ```ts
 * import { DprintTasks } from "jsr:@zuke/dprint";
 * await DprintTasks.fmt((s) => s.config("dprint.json"));
 * await DprintTasks.check((s) => s.files("src/**\/*.ts"));
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

/** Shared options for a `dprint` subcommand (`fmt` or `check`). */
export abstract class DprintSettings extends ToolSettings {
  #config?: string;
  #files: string[] = [];
  #excludes: string[] = [];
  #incremental = false;
  #allowNoFiles = false;

  /** The default executable this settings class invokes: `dprint`. */
  protected override defaultTool(): string {
    return "dprint";
  }

  /** Resolve the binary from `node_modules/.bin` by default — dprint is an npm-distributed tool. */
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }

  /** The dprint subcommand this settings class runs. */
  protected abstract subcommand(): string;

  /** Use an explicit config file (`-c`/`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** File paths or globs to format/check (positional); repeatable. */
  files(...patterns: PathLike[]): this {
    this.#files.push(...patterns.map(String));
    return this;
  }

  /** Exclude files matching a pattern (`--excludes`); repeatable. */
  excludes(...patterns: string[]): this {
    for (const pattern of patterns) this.#excludes.push("--excludes", pattern);
    return this;
  }

  /** Only process files that changed since the last run (`--incremental`). */
  incremental(): this {
    this.#incremental = true;
    return this;
  }

  /** Do not error when no files are matched (`--allow-no-files`). */
  allowNoFiles(): this {
    this.#allowNoFiles = true;
    return this;
  }

  /** Assemble the `dprint <subcommand>` argv from the configured options. */
  protected override buildArgs(): string[] {
    const argv = [this.subcommand()];
    if (this.#config !== undefined) argv.push("-c", this.#config);
    argv.push(...this.#excludes);
    if (this.#incremental) argv.push("--incremental");
    if (this.#allowNoFiles) argv.push("--allow-no-files");
    argv.push(...this.#files);
    return argv;
  }
}

/** Settings for `dprint fmt` (format files in place). */
export class DprintFmtSettings extends DprintSettings {
  /** The dprint subcommand this settings class runs: `fmt`. */
  protected override subcommand(): string {
    return "fmt";
  }
}

/** Settings for `dprint check` (verify formatting without writing). */
export class DprintCheckSettings extends DprintSettings {
  /** The dprint subcommand this settings class runs: `check`. */
  protected override subcommand(): string {
    return "check";
  }
}

/** The shape of {@link DprintTasks}. */
export interface DprintTasksApi {
  /** Format files in place: `dprint fmt`. */
  fmt(configure?: Configure<DprintFmtSettings>): Promise<CommandOutput>;
  /** Verify formatting: `dprint check`. */
  check(configure?: Configure<DprintCheckSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `dprint` code formatter. */
export const DprintTasks: DprintTasksApi = {
  /** Format files in place: `dprint fmt`. */
  fmt(configure?: Configure<DprintFmtSettings>): Promise<CommandOutput> {
    return runSettings(new DprintFmtSettings(), configure);
  },
  /** Verify formatting: `dprint check`. */
  check(configure?: Configure<DprintCheckSettings>): Promise<CommandOutput> {
    return runSettings(new DprintCheckSettings(), configure);
  },
};
