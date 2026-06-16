/**
 * `GcloudTasks` — a typed wrapper for the `gcloud` CLI (Google Cloud SDK), in
 * the same settings-lambda style as the other Zuke tool wrappers.
 *
 * `gcloud` is vast, so the wrapper is a flexible command builder rather than a
 * per-command API: name the command group and verb with `.command(...)`, set
 * the common global flags fluently, and pass anything else with `.flag(...)` or
 * the `.args(...)` escape hatch.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.run((s) =>
 *   s.command("run", "deploy", "api")
 *     .project("my-proj").flag("region", "us-central1").quiet()
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `gcloud` invocation. */
export class GcloudSettings extends ToolSettings {
  #command: string[] = [];
  #project?: string;
  #account?: string;
  #configuration?: string;
  #format?: string;
  #verbosity?: string;
  #noPrompt = false;
  #flags: string[] = [];

  protected override defaultTool(): string {
    return "gcloud";
  }

  /** The command path and verb, e.g. `command("run", "deploy", "api")`. */
  command(...parts: Array<string | number>): this {
    this.#command.push(...parts.map(String));
    return this;
  }

  /** Target Google Cloud project (`--project`). */
  project(id: string): this {
    this.#project = id;
    return this;
  }

  /** Account to run as (`--account`). */
  account(email: string): this {
    this.#account = email;
    return this;
  }

  /** Named gcloud configuration to use (`--configuration`). */
  configuration(name: string): this {
    this.#configuration = name;
    return this;
  }

  /** Output format, e.g. `json`, `yaml`, `value(name)` (`--format`). */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Logging verbosity: `debug`, `info`, `warning`, `error`, … (`--verbosity`). */
  verbosity(level: string): this {
    this.#verbosity = level;
    return this;
  }

  /**
   * Disable interactive prompts, accepting defaults (gcloud's `--quiet`). Named
   * `noPrompt` to avoid clashing with the base `.quiet()`, which suppresses
   * Zuke's own output streaming.
   */
  noPrompt(): this {
    this.#noPrompt = true;
    return this;
  }

  /**
   * Add an arbitrary flag. With a value it renders `--name value`; without one
   * it renders the bare `--name`. Repeatable.
   */
  flag(name: string, value?: string | number): this {
    this.#flags.push(`--${name}`);
    if (value !== undefined) this.#flags.push(String(value));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = [...this.#command];
    if (this.#project !== undefined) argv.push("--project", this.#project);
    if (this.#account !== undefined) argv.push("--account", this.#account);
    if (this.#configuration !== undefined) {
      argv.push("--configuration", this.#configuration);
    }
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#verbosity !== undefined) {
      argv.push("--verbosity", this.#verbosity);
    }
    if (this.#noPrompt) argv.push("--quiet");
    argv.push(...this.#flags);
    return argv;
  }
}

/** The shape of {@link GcloudTasks}. */
export interface GcloudTasksApi {
  /** Run a `gcloud` command. */
  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `gcloud` CLI. */
export const GcloudTasks: GcloudTasksApi = {
  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput> {
    return runSettings(new GcloudSettings(), configure);
  },
};
