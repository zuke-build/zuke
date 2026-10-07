// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az group` — resource groups: create, show, delete, and whether one exists.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * if (!await AzTasks.resourceGroupExists("rg-preview-42")) {
 *   await AzTasks.groupCreate((s) =>
 *     s.name("rg-preview-42").location("westeurope").tag("pr", "42")
 *   );
 * }
 * await AzTasks.groupDelete((s) => s.name("rg-preview-42").yes().noWait());
 * ```
 *
 * @module
 */

import { AzSettings } from "./settings.ts";
import { option, pair, required } from "./validate.ts";

/** `group <verb> --name=<name>`, refused without a name. */
function groupTokens(
  verb: string,
  task: string,
  name: string | undefined,
): string[] {
  const group = required(
    name,
    task,
    "no resource group named — add .name('rg').",
  );
  return ["group", verb, option("--name", group)];
}

/** The resource types `group delete --force-deletion-types` accepts. */
export type AzForceDeletionType =
  | "Microsoft.Compute/virtualMachines"
  | "Microsoft.Compute/virtualMachineScaleSets"
  | "Microsoft.Databricks/workspaces";

/** Settings for `az group create`. */
export class AzGroupCreateSettings extends AzSettings {
  #name?: string;
  #location?: string;
  readonly #tags: Array<[string, string]> = [];
  #managedBy?: string;

  /** The resource group's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The region to create it in (`--location`), e.g. `"westeurope"`. */
  location(location: string): this {
    this.#location = location;
    return this;
  }

  /** A tag (`--tags key=value`); repeatable. */
  tag(key: string, value: string): this {
    this.#tags.push([key, value]);
    return this;
  }

  /** The id of the resource that manages the group (`--managed-by`). */
  managedBy(id: string): this {
    this.#managedBy = id;
    return this;
  }

  /** Emit `group create` with its options. */
  protected override leadingTokens(): string[] {
    const argv = groupTokens("create", "groupCreate", this.#name);
    const location = required(
      this.#location,
      "groupCreate",
      "no location — add .location('westeurope').",
    );
    argv.push(option("--location", location));
    if (this.#tags.length > 0) {
      argv.push(
        "--tags",
        ...this.#tags.map(([k, v]) => pair("groupCreate", "tag", k, v)),
      );
    }
    if (this.#managedBy !== undefined) {
      argv.push(option("--managed-by", this.#managedBy));
    }
    return argv;
  }
}

/** Settings for `az group show`. */
export class AzGroupShowSettings extends AzSettings {
  #name?: string;

  /** The resource group's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** Emit `group show`. */
  protected override leadingTokens(): string[] {
    return groupTokens("show", "groupShow", this.#name);
  }
}

/**
 * Settings for `az group delete`. The CLI asks for confirmation unless
 * {@link yes} is set — and fails, without a terminal to ask on.
 */
export class AzGroupDeleteSettings extends AzSettings {
  #name?: string;
  #yes = false;
  #noWait = false;
  #forceDeletionTypes?: AzForceDeletionType;

  /** The resource group's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** Delete without asking (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Return once the deletion has started (`--no-wait`). */
  noWait(): this {
    this.#noWait = true;
    return this;
  }

  /** Force-delete the group's resources of this type (`--force-deletion-types`). */
  forceDeletionTypes(type: AzForceDeletionType): this {
    this.#forceDeletionTypes = type;
    return this;
  }

  /** Emit `group delete` with its options. */
  protected override leadingTokens(): string[] {
    const argv = groupTokens("delete", "groupDelete", this.#name);
    if (this.#forceDeletionTypes !== undefined) {
      argv.push(option("--force-deletion-types", this.#forceDeletionTypes));
    }
    if (this.#yes) argv.push("--yes");
    if (this.#noWait) argv.push("--no-wait");
    return argv;
  }
}

/** Settings for `az group exists`, which prints `true` or `false`. */
export class AzGroupExistsSettings extends AzSettings {
  #name?: string;

  /** The resource group's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** Emit `group exists`. */
  protected override leadingTokens(): string[] {
    return groupTokens("exists", "groupExists", this.#name);
  }
}
