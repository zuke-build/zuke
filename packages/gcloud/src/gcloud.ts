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

import {
  type Configure,
  runSettings,
  SubcommandSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `gcloud` invocation. */
export class GcloudSettings extends SubcommandSettings {
  #project?: string;
  #account?: string;
  #configuration?: string;
  #format?: string;
  #verbosity?: string;
  #noPrompt = false;

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
