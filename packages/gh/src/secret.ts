// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh secret` — setting, listing and deleting the encrypted values Actions,
 * Dependabot and Codespaces read.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.secretSet((s) => s.name("NPM_TOKEN").body(token.value));
 * await GhTasks.secretDelete((s) => s.name("OLD_TOKEN"));
 * ```
 *
 * **On passing a secret as a value.** `.body(...)` becomes an argv entry, and
 * a process's arguments are readable by other processes on the same machine
 * for as long as it runs. That is a property of the command line, not of this
 * wrapper — nothing here can hide it. Prefer `.envFile(...)`, or omit the
 * value entirely and let gh read it from standard input, and source the value
 * from a `parameter().secret()` so it stays redacted in Zuke's own output.
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

/** Which application reads the secret (`--app`). */
export type GhSecretApp = "actions" | "agents" | "codespaces" | "dependabot";

/**
 * Base for the `secret` commands that name one scope: the application, and
 * whether the secret belongs to a repository, an organization, an
 * environment, or the authenticated user.
 */
export abstract class GhSecretScopeSettings extends GhCommandSettings {
  #app?: GhSecretApp;
  #org?: string;
  #environment?: string;
  #user = false;
  #repositories: string[] = [];
  #visibility?: GhScopeVisibility;

  /** Which application reads it (`--app`); gh's default is `actions`. */
  app(name: GhSecretApp): this {
    this.#app = name;
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

  /** Scope it to the authenticated user (`--user`). */
  user(): this {
    this.#user = true;
    return this;
  }

  /** Share an organization secret with these repositories (`--repos`). */
  repositories(...names: string[]): this {
    this.#repositories.push(...names);
    return this;
  }

  /** The visibility of an organization secret (`--visibility`). */
  visibility(value: GhScopeVisibility): this {
    this.#visibility = value;
    return this;
  }

  /** The scope flags, for a subclass to place among its own. */
  protected scopeFlags(task: string): string[] {
    if (
      this.#user && (this.#org !== undefined || this.#environment !== undefined)
    ) {
      throw new Error(
        `GhTasks.${task}: .user() scopes the secret to your account, which ` +
          ".org(...)/.environment(...) contradict — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#app !== undefined) argv.push("--app", this.#app);
    argv.push(...scopeArgs(task, {
      org: this.#org,
      environment: this.#environment,
      repositories: this.#repositories,
      visibility: this.#visibility,
    }));
    if (this.#user) argv.push("--user");
    return argv;
  }
}

/** Settings for `gh secret set`. */
export class GhSecretSetSettings extends GhSecretScopeSettings {
  #name?: string;
  #body?: string;
  #envFile?: string;
  #noStore = false;
  #noReposSelected = false;

  /** The secret's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * The secret's value (`--body`). Omit it and gh reads standard input, which
   * keeps the value out of the process's arguments — see the module docs.
   */
  body(value: string): this {
    this.#body = value;
    return this;
  }

  /** Read names and values from a dotenv file (`--env-file`). */
  envFile(path: PathLike): this {
    this.#envFile = String(path);
    return this;
  }

  /** Print the encrypted value instead of storing it (`--no-store`). */
  noStore(): this {
    this.#noStore = true;
    return this;
  }

  /** Share the organization secret with no repositories (`--no-repos-selected`). */
  noReposSelected(): this {
    this.#noReposSelected = true;
    return this;
  }

  /** The `gh secret set` command path. */
  protected override commandPath(): string[] {
    const argv = ["secret", "set"];
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }

  /** Assemble the `gh secret set` flags. */
  protected override commandFlags(): string[] {
    if (this.#name === undefined && this.#envFile === undefined) {
      throw new Error(
        "GhTasks.secretSet: .name(...) is required — unless .envFile(...) " +
          "supplies the names, which is the one form gh takes without one.",
      );
    }
    if (this.#name !== undefined && this.#envFile !== undefined) {
      throw new Error(
        "GhTasks.secretSet: .envFile(...) carries its own names, so it " +
          "cannot be combined with .name(...) — pick one.",
      );
    }
    const argv = [
      ...valueArgs("secretSet", this.#body, this.#envFile),
      ...this.scopeFlags("secretSet"),
    ];
    if (this.#noReposSelected) argv.push("--no-repos-selected");
    if (this.#noStore) argv.push("--no-store");
    return argv;
  }
}

/** Settings for `gh secret delete`. */
export class GhSecretDeleteSettings extends GhSecretScopeSettings {
  #name?: string;

  /** The secret's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The `gh secret delete` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GhTasks.secretDelete: .name(...) is required — it names the secret " +
          "to remove.",
      );
    }
    return ["secret", "delete", this.#name];
  }

  /** Assemble the `gh secret delete` flags. */
  protected override commandFlags(): string[] {
    return this.scopeFlags("secretDelete");
  }
}

/** Settings for `gh secret list`. */
export class GhSecretListSettings extends GhReadSettings {
  #app?: GhSecretApp;
  #org?: string;
  #environment?: string;
  #user = false;

  /** Which application's secrets to list (`--app`). */
  app(name: GhSecretApp): this {
    this.#app = name;
    return this;
  }

  /** List an organization's secrets (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** List an environment's secrets (`--env`). */
  environment(name: string): this {
    this.#environment = name;
    return this;
  }

  /** List your own secrets (`--user`). */
  user(): this {
    this.#user = true;
    return this;
  }

  /** The `gh secret list` command path. */
  protected override commandPath(): string[] {
    return ["secret", "list"];
  }

  /** Assemble the `gh secret list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#app !== undefined) argv.push("--app", this.#app);
    if (this.#org !== undefined) argv.push("--org", this.#org);
    if (this.#environment !== undefined) {
      argv.push("--env", this.#environment);
    }
    if (this.#user) argv.push("--user");
    argv.push(...this.readFlags());
    return argv;
  }
}

/**
 * One secret of {@link "./gh.ts".GhTasks.secretListEntries}. GitHub never
 * returns a secret's value, so an entry is its name and its metadata.
 */
export interface GhSecretEntry {
  /** The secret's name. */
  name?: string;
  /** When it was last updated, ISO 8601. */
  updatedAt?: string;
  /** The visibility of an organization secret. */
  visibility?: string;
}

/**
 * The `--json` fields {@link readSecrets} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhSecretEntry} describes.
 */
export const SECRET_LIST_FIELDS: readonly string[] = [
  "name",
  "updatedAt",
  "visibility",
];

/**
 * Parse `gh secret list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseSecrets(stdout: string): GhSecretEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhSecretEntry = {};
    const name = stringField(record, "name");
    const updatedAt = stringField(record, "updatedAt");
    const visibility = stringField(record, "visibility");
    if (name !== undefined) entry.name = name;
    if (updatedAt !== undefined) entry.updatedAt = updatedAt;
    if (visibility !== undefined) entry.visibility = visibility;
    return entry;
  });
}

/**
 * Run `gh secret list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.secretListEntries}.
 */
export async function readSecrets(
  configure?: Configure<GhSecretListSettings>,
): Promise<GhSecretEntry[]> {
  const settings = new GhSecretListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...SECRET_LIST_FIELDS).run();
  return parseSecrets(output.stdout);
}
