// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh variable` — the plain-text configuration Actions reads alongside its
 * secrets: set, get, list, and delete.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.variableSet((s) => s.name("REGION").body("eu-central-1"));
 * const region = await GhTasks.variableValue((s) => s.name("REGION"));
 * ```
 *
 * A variable is not a secret: GitHub stores and returns its value in the
 * clear, and {@link "./gh.ts".GhTasks.variableValue} hands it back. Anything
 * that must stay hidden belongs in {@link "./secret.ts".GhSecretSetSettings}
 * instead.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { GhCommandSettings, GhReadSettings } from "./subcommand.ts";
import {
  type GhScopeVisibility,
  scopeArgs,
  valueArgs,
} from "./actions_scope.ts";
import { parseJsonArray, stringField } from "./json_array.ts";

/** Settings for `gh variable set`. */
export class GhVariableSetSettings extends GhCommandSettings {
  #name?: string;
  #body?: string;
  #envFile?: string;
  #org?: string;
  #environment?: string;
  #repositories: string[] = [];
  #visibility?: GhScopeVisibility;

  /** The variable's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Its value (`--body`); omit it and gh reads standard input. */
  body(value: string): this {
    this.#body = value;
    return this;
  }

  /** Read names and values from a dotenv file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Scope it to an organization (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** Scope it to a deployment environment (`--env`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** Share an organization variable with these repositories (`--repos`). */
  repositories(...names: string[]): this {
    this.#repositories.push(...names);
    return this;
  }

  /** The visibility of an organization variable (`--visibility`). */
  visibility(value: GhScopeVisibility): this {
    this.#visibility = value;
    return this;
  }

  /** The `gh variable set` command path. */
  protected override commandPath(): string[] {
    const argv = ["variable", "set"];
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }

  /** Assemble the `gh variable set` flags. */
  protected override commandFlags(): string[] {
    if (this.#name === undefined && this.#envFile === undefined) {
      throw new Error(
        "GhTasks.variableSet: .name(...) is required — unless .envFile(...) " +
          "supplies the names, which is the one form gh takes without one.",
      );
    }
    if (this.#name !== undefined && this.#envFile !== undefined) {
      throw new Error(
        "GhTasks.variableSet: .envFile(...) carries its own names, so it " +
          "cannot be combined with .name(...) — pick one.",
      );
    }
    return [
      ...valueArgs("variableSet", this.#body, this.#envFile),
      ...scopeArgs("variableSet", {
        org: this.#org,
        environment: this.#environment,
        repositories: this.#repositories,
        visibility: this.#visibility,
      }),
    ];
  }
}

/** Settings for `gh variable get`. */
export class GhVariableGetSettings extends GhReadSettings {
  #name?: string;
  #org?: string;
  #environment?: string;

  /** The variable's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Read an organization variable (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** Read an environment variable (`--env`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** The `gh variable get` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GhTasks.variableGet: .name(...) is required — it names the variable " +
          "to read.",
      );
    }
    return ["variable", "get", this.#name];
  }

  /** Assemble the `gh variable get` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#org !== undefined) argv.push("--org", this.#org);
    if (this.#environment !== undefined) {
      argv.push("--env", this.#environment);
    }
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh variable list`. */
export class GhVariableListSettings extends GhReadSettings {
  #org?: string;
  #environment?: string;

  /** List an organization's variables (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** List an environment's variables (`--env`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** The `gh variable list` command path. */
  protected override commandPath(): string[] {
    return ["variable", "list"];
  }

  /** Assemble the `gh variable list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#org !== undefined) argv.push("--org", this.#org);
    if (this.#environment !== undefined) {
      argv.push("--env", this.#environment);
    }
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh variable delete`. */
export class GhVariableDeleteSettings extends GhCommandSettings {
  #name?: string;
  #org?: string;
  #environment?: string;

  /** The variable's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Delete an organization variable (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** Delete an environment variable (`--env`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** The `gh variable delete` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GhTasks.variableDelete: .name(...) is required — it names the " +
          "variable to remove.",
      );
    }
    return ["variable", "delete", this.#name];
  }

  /** Assemble the `gh variable delete` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#org !== undefined) argv.push("--org", this.#org);
    if (this.#environment !== undefined) {
      argv.push("--env", this.#environment);
    }
    return argv;
  }
}

/** One variable of {@link "./gh.ts".GhTasks.variableListEntries}. */
export interface GhVariableEntry {
  /** The variable's name. */
  name?: string;
  /** Its value, which GitHub returns in the clear. */
  value?: string;
  /** When it was last updated, ISO 8601. */
  updatedAt?: string;
  /** The visibility of an organization variable. */
  visibility?: string;
}

/**
 * The `--json` fields {@link readVariables} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhVariableEntry} describes.
 */
export const VARIABLE_LIST_FIELDS: readonly string[] = [
  "name",
  "value",
  "updatedAt",
  "visibility",
];

/**
 * Parse `gh variable list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseVariables(stdout: string): GhVariableEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhVariableEntry = {};
    const name = stringField(record, "name");
    const value = stringField(record, "value");
    const updatedAt = stringField(record, "updatedAt");
    const visibility = stringField(record, "visibility");
    if (name !== undefined) entry.name = name;
    if (value !== undefined) entry.value = value;
    if (updatedAt !== undefined) entry.updatedAt = updatedAt;
    if (visibility !== undefined) entry.visibility = visibility;
    return entry;
  });
}

/**
 * Run `gh variable list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.variableListEntries}.
 */
export async function readVariables(
  configure?: Configure<GhVariableListSettings>,
): Promise<GhVariableEntry[]> {
  const settings = new GhVariableListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...VARIABLE_LIST_FIELDS).run();
  return parseVariables(output.stdout);
}

/**
 * Run `gh variable get` and hand back the value, without the single line
 * ending gh prints after it. Only that ending is removed — a value that
 * genuinely ends in a space keeps it. Backs
 * {@link "./gh.ts".GhTasks.variableValue}.
 */
export async function readVariableValue(
  configure?: Configure<GhVariableGetSettings>,
): Promise<string> {
  const settings = new GhVariableGetSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.run();
  return output.stdout.replace(/\r?\n$/, "");
}
