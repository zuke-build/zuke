// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link GcloudSettings} — the base every `gcloud` command's settings extend:
 * the binary, the command-path builder, and the global flags that apply to
 * every command (`--project`, `--account`, `--format`, `--quiet`, …).
 *
 * It lives apart from the commands so a command in its own module (see
 * `cloud_run.ts`) can extend it without importing the module that assembles
 * `GcloudTasks`, which would import it back.
 *
 * A command's settings class emits its whole invocation — the command path, its
 * operands and its own flags — from `leadingTokens`, so the validation and the
 * argv it guards sit together. The global flags follow from `middleTokens`,
 * which is an order gcloud accepts.
 *
 * It also carries the runner seam ({@link GcloudSettings.runner}): a test, or a
 * build that executes gcloud some other way, answers the prepared command
 * instead of a spawned process.
 *
 * @module
 */

import { Command, CommandError, type CommandOutput } from "@zuke/core/shell";
import { SubcommandSettings } from "@zuke/core/tooling";

/**
 * Runs one prepared `gcloud` command and returns what the process produced.
 * The default spawns gcloud; a test, or a build that executes gcloud some
 * other way, injects its own with {@link GcloudSettings.runner}. The runner
 * only produces the output: the exit code is judged afterwards exactly as for
 * a spawned process, so a non-zero `code` still raises a `CommandError`
 * unless the settings say `.noThrow()`.
 */
export type GcloudSettingsRunner = (
  settings: GcloudSettings,
) => Promise<CommandOutput>;

/**
 * Throw core's `CommandError` for a failed exit, rendered through a `Command`
 * so the run's redactor masks the line exactly as it does for a spawned
 * command's failure. Internal: the runner path of {@link GcloudSettings.run}
 * and the readers, which insist on success whatever `.noThrow()` said, share
 * it.
 */
export function failOnExit(
  settings: GcloudSettings,
  output: CommandOutput,
): void {
  if (output.code === 0) return;
  const line = new Command(settings.argv()).commandLine;
  throw new CommandError(line, output.code, output.stderr);
}

/** Settings for a `gcloud` invocation. */
export class GcloudSettings extends SubcommandSettings {
  #project?: string;
  #account?: string;
  #configuration?: string;
  #format?: string;
  #verbosity?: string;
  #noPrompt = false;
  #runner?: GcloudSettingsRunner;

  /** The default executable name (`gcloud`). */
  protected override defaultTool(): string {
    return "gcloud";
  }

  /**
   * Add tags to a container image across registries:
   * `gcloud container images add-tag <source> <destination…>`. Each argument is
   * a discrete argv token, so an image reference can't inject flags. Runs with
   * `--quiet` (the re-tag is non-interactive automation; `add-tag` otherwise
   * prompts for confirmation).
   */
  containerImagesAddTag(source: string, ...destinations: string[]): this {
    this.command("container", "images", "add-tag", source, ...destinations);
    return this.noPrompt();
  }

  /**
   * Describe a Cloud SQL instance:
   * `gcloud sql instances describe <instance>`. Add `.format("json")` to get a
   * machine-readable body to parse from the command's stdout.
   */
  sqlInstancesDescribe(instance: string): this {
    return this.command("sql", "instances", "describe", instance);
  }

  /**
   * Block until a Cloud SQL operation completes:
   * `gcloud sql operations wait <operation>` — the typed form of the
   * poll-an-operation shell loop.
   */
  sqlOperationsWait(operation: string): this {
    return this.command("sql", "operations", "wait", operation);
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
   * Replace how this command is run. The default spawns gcloud; this is the
   * seam a test answers commands through, and the way a build executes gcloud
   * through something else. The runner reads the argv from the settings it is
   * handed and must not call their `run()` — that is the call it replaces.
   */
  runner(run: GcloudSettingsRunner): this {
    this.#runner = run;
    return this;
  }

  /**
   * Run the command — through the {@link runner} when one is set, otherwise
   * by spawning gcloud. Either way the output is reported to the settings'
   * output hook and a non-zero exit throws a `CommandError` unless
   * `.noThrow()` was called.
   */
  override async run(): Promise<CommandOutput> {
    const runner = this.#runner;
    if (runner === undefined) return await super.run();
    // Build the argv first, as a real spawn does, so every refusal a setter's
    // value triggers fires before a runner sees the settings.
    this.argv();
    const output = await runner(this);
    this.onOutput(output);
    if (this.throwsOnError) failOnExit(this, output);
    return output;
  }

  /** Emit gcloud's common global flags between the command path and the flags. */
  protected override middleTokens(): string[] {
    const argv: string[] = [];
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
    return argv;
  }
}
