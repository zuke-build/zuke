// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud config` group — the properties every other command inherits.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.configSet((s) => s.property("project").value(projectId));
 * const project = await GcloudTasks.configValue((s) => s.property("project"));
 * ```
 *
 * Each settings class here emits its whole command — the path, its operands and
 * its own flags — from `leadingTokens`, so the validation and the argv it
 * guards live together. The global flags (`--project`, `--format`, `--quiet`)
 * still follow from the shared base, which is the order gcloud accepts.
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";

/** Settings for `gcloud config set`. */
export class GcloudConfigSetSettings extends GcloudSettings {
  #property?: string;
  #value?: string;

  /** The property to set (positional), e.g. `"project"` or `"run/region"`. */
  property(name: string): this {
    this.#property = name;
    return this;
  }

  /** The value to set it to (positional). */
  value(text: string): this {
    this.#value = text;
    return this;
  }

  /** Emit `config set` with the property and value. */
  protected override leadingTokens(): string[] {
    if (this.#property === undefined || this.#value === undefined) {
      throw new Error(
        "GcloudTasks.configSet: gcloud config set takes a property and a " +
          "value — add .property('project').value(id).",
      );
    }
    return ["config", "set", this.#property, this.#value];
  }
}

/** Settings for `gcloud config unset`. */
export class GcloudConfigUnsetSettings extends GcloudSettings {
  #property?: string;

  /** The property to clear (positional). */
  property(name: string): this {
    this.#property = name;
    return this;
  }

  /** Emit `config unset` with the property. */
  protected override leadingTokens(): string[] {
    if (this.#property === undefined) {
      throw new Error(
        "GcloudTasks.configUnset: no property named — add " +
          ".property('project').",
      );
    }
    return ["config", "unset", this.#property];
  }
}

/** Settings for `gcloud config get-value`. */
export class GcloudConfigGetValueSettings extends GcloudSettings {
  #property?: string;

  /** The property to read (positional). */
  property(name: string): this {
    this.#property = name;
    return this;
  }

  /** Emit `config get-value` with the property. */
  protected override leadingTokens(): string[] {
    if (this.#property === undefined) {
      throw new Error(
        "GcloudTasks.configGetValue: no property named — add " +
          ".property('project').",
      );
    }
    return ["config", "get-value", this.#property];
  }
}

/** Settings for `gcloud config list`. */
export class GcloudConfigListSettings extends GcloudSettings {
  #all = false;

  /** Include properties left at their defaults (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Emit `config list`. */
  protected override leadingTokens(): string[] {
    const argv = ["config", "list"];
    if (this.#all) argv.push("--all");
    return argv;
  }
}
