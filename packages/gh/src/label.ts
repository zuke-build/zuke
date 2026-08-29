// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh label` — the labels a build applies to issues and pull requests:
 * create, edit, delete, list, and clone from another repository.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.labelCreate((s) => s.name("flaky").color("d73a4a").force());
 * const labels = await GhTasks.labelListEntries((s) => s.search("bug"));
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GhCommandSettings, GhWebReadSettings } from "./subcommand.ts";
import { parseJsonArray, stringField } from "./json_array.ts";

/** What `gh label list --sort` orders the labels by. */
export type GhLabelSort = "created" | "name";

/** Settings for `gh label list`. */
export class GhLabelListSettings extends GhWebReadSettings {
  #search?: string;
  #sort?: GhLabelSort;
  #order?: string;
  #limit?: number;

  /** Search names and descriptions (`--search`). */
  search(query: string): this {
    this.#search = query;
    return this;
  }

  /** What to order by (`--sort`); gh's default is `created`. */
  sort(field: GhLabelSort): this {
    this.#sort = field;
    return this;
  }

  /** The direction (`--order`): `asc` or `desc`. */
  order(direction: "asc" | "desc"): this {
    this.#order = direction;
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 30. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The `gh label list` command path. */
  protected override commandPath(): string[] {
    return ["label", "list"];
  }

  /** Assemble the `gh label list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#search !== undefined) argv.push("--search", this.#search);
    if (this.#sort !== undefined) argv.push("--sort", this.#sort);
    if (this.#order !== undefined) argv.push("--order", this.#order);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh label create`. */
export class GhLabelCreateSettings extends GhCommandSettings {
  #name?: string;
  #color?: string;
  #description?: string;
  #force = false;

  /** The label's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Its colour (`--color`), as a hex triplet; gh accepts it with or without `#`. */
  color(hex: string): this {
    this.#color = hex;
    return this;
  }

  /** Its description (`--description`). */
  description(text: string): this {
    this.#description = text;
    return this;
  }

  /** Update the label when it already exists rather than failing (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `gh label create` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error("GhTasks.labelCreate: .name(...) is required.");
    }
    return ["label", "create", this.#name];
  }

  /** Assemble the `gh label create` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#color !== undefined) argv.push("--color", this.#color);
    if (this.#description !== undefined) {
      argv.push("--description", this.#description);
    }
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `gh label edit`. */
export class GhLabelEditSettings extends GhCommandSettings {
  #name?: string;
  #newName?: string;
  #color?: string;
  #description?: string;

  /** The label to edit, by its current name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Rename it (`--name`). */
  newName(value: string): this {
    this.#newName = value;
    return this;
  }

  /** Set its colour (`--color`). */
  color(hex: string): this {
    this.#color = hex;
    return this;
  }

  /** Set its description (`--description`). */
  description(text: string): this {
    this.#description = text;
    return this;
  }

  /** The `gh label edit` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GhTasks.labelEdit: .name(...) is required — it names the label to " +
          "edit. Use .newName(...) to rename it.",
      );
    }
    return ["label", "edit", this.#name];
  }

  /** Assemble the `gh label edit` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#newName !== undefined) argv.push("--name", this.#newName);
    if (this.#color !== undefined) argv.push("--color", this.#color);
    if (this.#description !== undefined) {
      argv.push("--description", this.#description);
    }
    return argv;
  }
}

/** Settings for `gh label delete`. */
export class GhLabelDeleteSettings extends GhCommandSettings {
  #name?: string;
  #yes = false;

  /** The label to delete (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Skip the confirmation a delete otherwise prompts for (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh label delete` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error("GhTasks.labelDelete: .name(...) is required.");
    }
    return ["label", "delete", this.#name];
  }

  /** Assemble the `gh label delete` flags. */
  protected override commandFlags(): string[] {
    if (!this.#yes) {
      throw new Error(
        "GhTasks.labelDelete: gh prompts before deleting, which a build " +
          "cannot answer — add .yes() to mean it.",
      );
    }
    return ["--yes"];
  }
}

/** Settings for `gh label clone`. */
export class GhLabelCloneSettings extends GhCommandSettings {
  #source?: string;
  #force = false;

  /** The repository to copy the labels from, as `owner/name` (required). */
  source(slug: string): this {
    this.#source = slug;
    return this;
  }

  /** Overwrite labels of the same name in the destination (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `gh label clone` command path. */
  protected override commandPath(): string[] {
    if (this.#source === undefined) {
      throw new Error(
        "GhTasks.labelClone: .source(...) is required — it names the " +
          "repository to copy the labels from.",
      );
    }
    return ["label", "clone", this.#source];
  }

  /** Assemble the `gh label clone` flags. */
  protected override commandFlags(): string[] {
    return this.#force ? ["--force"] : [];
  }
}

/** One label of {@link "./gh.ts".GhTasks.labelListEntries}. */
export interface GhLabelEntry {
  /** The label's name. */
  name?: string;
  /** Its colour, as a hex triplet without the `#`. */
  color?: string;
  /** Its description. */
  description?: string;
}

/**
 * The `--json` fields {@link readLabels} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhLabelEntry} describes.
 */
export const LABEL_LIST_FIELDS: readonly string[] = [
  "name",
  "color",
  "description",
];

/**
 * Parse `gh label list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseLabels(stdout: string): GhLabelEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhLabelEntry = {};
    const name = stringField(record, "name");
    const color = stringField(record, "color");
    const description = stringField(record, "description");
    if (name !== undefined) entry.name = name;
    if (color !== undefined) entry.color = color;
    if (description !== undefined) entry.description = description;
    return entry;
  });
}

/**
 * Run `gh label list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.labelListEntries}.
 */
export async function readLabels(
  configure?: Configure<GhLabelListSettings>,
): Promise<GhLabelEntry[]> {
  const settings = new GhLabelListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...LABEL_LIST_FIELDS).run();
  return parseLabels(output.stdout);
}
