// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link AzResourceSettings} — the base of every command that names one
 * resource by `--name` and `--resource-group`: an AKS cluster, a container
 * app, a web app, a function app. One pair of setters and one rendering of
 * them, rather than a copy per command.
 *
 * @module
 */

import { AzSettings } from "./settings.ts";
import { option } from "./validate.ts";

/** Settings for a command on one named resource in a resource group. */
export abstract class AzResourceSettings extends AzSettings {
  #name?: string;
  #resourceGroup?: string;

  /** The resource's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The resource group the resource is in (`--resource-group`). */
  resourceGroup(name: string): this {
    this.#resourceGroup = name;
    return this;
  }

  /**
   * `--name` and `--resource-group`, refused unless both are set; `what`
   * names the resource in the refusal, `task` the command.
   */
  protected resourceTokens(task: string, what: string): string[] {
    if (this.#name === undefined) {
      throw new Error(
        `AzTasks.${task}: no ${what} named — add .name(...) and ` +
          ".resourceGroup(...).",
      );
    }
    return [option("--name", this.#name), this.#groupToken(task, what)];
  }

  /**
   * `--resource-group`, refused unless set, and `--name` only when it is set
   * — for a command whose name the CLI can default.
   */
  protected optionalNameTokens(task: string, what: string): string[] {
    const group = this.#groupToken(task, what);
    return this.#name === undefined
      ? [group]
      : [option("--name", this.#name), group];
  }

  /** `--resource-group`, refused unless set. */
  #groupToken(task: string, what: string): string {
    if (this.#resourceGroup === undefined) {
      throw new Error(
        `AzTasks.${task}: no resource group for the ${what} — add ` +
          ".resourceGroup(...).",
      );
    }
    return option("--resource-group", this.#resourceGroup);
  }
}
