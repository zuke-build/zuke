/**
 * `JsrTasks` — typed task functions for the [JSR](https://jsr.io) CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { JsrTasks } from "jsr:@zuke/jsr";
 * await JsrTasks.publish((s) => s.dryRun().allowSlowTypes());
 * await JsrTasks.add((s) => s.packages("@std/assert"));
 * ```
 *
 * The binary is `jsr` from PATH. Arguments stay a discrete argv array
 * end-to-end — never a concatenated shell string — so command construction is
 * injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `jsr` subcommand settings: the binary is `jsr`. */
abstract class JsrSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "jsr";
  }
}

/** Settings for `jsr publish`. */
export class JsrPublishSettings extends JsrSettings {
  #dryRun = false;
  #allowSlowTypes = false;
  #allowDirty = false;
  #noCheck = false;
  #provenance = false;
  #token?: string;

  /** Validate without publishing (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Permit slow types in the published package (`--allow-slow-types`). */
  allowSlowTypes(): this {
    this.#allowSlowTypes = true;
    return this;
  }

  /** Publish even with an uncommitted working tree (`--allow-dirty`). */
  allowDirty(): this {
    this.#allowDirty = true;
    return this;
  }

  /** Skip type-checking before publishing (`--no-check`). */
  noCheck(): this {
    this.#noCheck = true;
    return this;
  }

  /** Attach provenance attestation in CI (`--provenance`). */
  provenance(): this {
    this.#provenance = true;
    return this;
  }

  /** Authenticate with a token instead of the interactive flow (`--token`). */
  token(value: string): this {
    this.#token = value;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["publish"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#allowSlowTypes) argv.push("--allow-slow-types");
    if (this.#allowDirty) argv.push("--allow-dirty");
    if (this.#noCheck) argv.push("--no-check");
    if (this.#provenance) argv.push("--provenance");
    if (this.#token !== undefined) argv.push("--token", this.#token);
    return argv;
  }
}

/** Settings for `jsr add` (install a JSR dependency). */
export class JsrAddSettings extends JsrSettings {
  #packages: string[] = [];
  #dev = false;

  /** Package specs to add, e.g. `@std/assert` (required). */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Add as a development dependency (`--save-dev`). */
  dev(): this {
    this.#dev = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error("JsrTasks.add: .packages() requires at least one spec.");
    }
    const argv = ["add"];
    if (this.#dev) argv.push("--save-dev");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `jsr remove`. */
export class JsrRemoveSettings extends JsrSettings {
  #packages: string[] = [];

  /** Package names to remove (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "JsrTasks.remove: .packages() requires at least one name.",
      );
    }
    return ["remove", ...this.#packages];
  }
}

/** The shape of {@link JsrTasks}. */
export interface JsrTasksApi {
  /** Publish the package: `jsr publish`. */
  publish(configure?: Configure<JsrPublishSettings>): Promise<CommandOutput>;
  /** Add a JSR dependency: `jsr add`. */
  add(configure?: Configure<JsrAddSettings>): Promise<CommandOutput>;
  /** Remove a dependency: `jsr remove`. */
  remove(configure?: Configure<JsrRemoveSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `jsr` CLI. */
export const JsrTasks: JsrTasksApi = {
  publish(configure?: Configure<JsrPublishSettings>): Promise<CommandOutput> {
    return runSettings(new JsrPublishSettings(), configure);
  },
  add(configure?: Configure<JsrAddSettings>): Promise<CommandOutput> {
    return runSettings(new JsrAddSettings(), configure);
  },
  remove(configure?: Configure<JsrRemoveSettings>): Promise<CommandOutput> {
    return runSettings(new JsrRemoveSettings(), configure);
  },
};
