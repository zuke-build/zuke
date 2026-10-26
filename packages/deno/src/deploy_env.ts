// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `deno deploy env`: an application's environment variables.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoDeployAppSettings, pathOperand } from "./deploy_settings.ts";

/** `name` if it is an environment variable name, else a friendly error. */
function variableName(task: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `DenoDeployTasks.${task}: ${JSON.stringify(name)} is not an ` +
        `environment variable name.`,
    );
  }
  return name;
}

/** `variable` if set, else a friendly error naming the setter. */
function required(task: string, variable: string | undefined): string {
  if (variable === undefined) {
    throw new Error(`DenoDeployTasks.${task}: .variable() is required.`);
  }
  return variable;
}

/** Settings for `deno deploy env list`. */
export class DenoDeployEnvListSettings extends DenoDeployAppSettings {
  /** `deno deploy env list`. */
  protected override commandPath(): string[] {
    return ["env", "list"];
  }

  /** No arguments of its own. */
  protected override commandArgs(): string[] {
    return [];
  }
}

/** The `deno deploy env` subcommands that set a variable's value. */
export type DenoDeployEnvValueCommand = "add" | "update-value";

/**
 * Settings for `deno deploy env add` and `deno deploy env update-value`.
 *
 * The value is a positional argument, so one that starts with `-` would be
 * read as a flag and is refused; load such a value from a file with
 * `DenoDeployTasks.envLoad` instead.
 */
export class DenoDeployEnvValueSettings extends DenoDeployAppSettings {
  readonly #command: DenoDeployEnvValueCommand;
  #variable?: string;
  #value?: string;
  #secret = false;

  /** Settings for `deno deploy env <command>`. */
  constructor(command: DenoDeployEnvValueCommand) {
    super();
    this.#command = command;
  }

  #task(): string {
    return this.#command === "add" ? "envAdd" : "envUpdateValue";
  }

  /** The variable to set; required. */
  variable(name: string): this {
    this.#variable = variableName(this.#task(), name);
    return this;
  }

  /** The variable's value; required, unless set by {@link secretValue}. */
  value(value: string): this {
    if (value === "") {
      throw new Error(
        `DenoDeployTasks.${this.#task()}: the value is empty, which the CLI ` +
          `refuses; delete the variable with DenoDeployTasks.envDelete instead.`,
      );
    }
    if (value.startsWith("-")) {
      throw new Error(
        `DenoDeployTasks.${this.#task()}: a value starting with "-" would be ` +
          `read as a flag; load it from a file with DenoDeployTasks.envLoad.`,
      );
    }
    this.#value = value;
    return this;
  }

  /**
   * A secret value: masked in the build's logs and errors, and for `add`
   * stored as a secret (`--secret`).
   */
  secretValue(value: string): this {
    this.markSecret(value);
    this.#secret = true;
    return this.value(value);
  }

  /** `deno deploy env add|update-value`. */
  protected override commandPath(): string[] {
    return ["env", this.#command];
  }

  /** `--secret` for a secret `add`, then the variable and its value. */
  protected override commandArgs(): string[] {
    const variable = required(this.#task(), this.#variable);
    if (this.#value === undefined) {
      throw new Error(
        `DenoDeployTasks.${this.#task()}: .value() or .secretValue() is ` +
          `required.`,
      );
    }
    const secret = this.#secret && this.#command === "add" ? ["--secret"] : [];
    return [...secret, variable, this.#value];
  }
}

/** Settings for `deno deploy env update-contexts`. */
export class DenoDeployEnvUpdateContextsSettings extends DenoDeployAppSettings {
  #variable?: string;
  #contexts: string[] = [];

  /** The variable to update; required. */
  variable(name: string): this {
    this.#variable = variableName("envUpdateContexts", name);
    return this;
  }

  /** A context the variable applies in, e.g. `production`; repeatable. */
  context(name: string): this {
    if (name.startsWith("-")) {
      throw new Error(
        `DenoDeployTasks.envUpdateContexts: ${JSON.stringify(name)} would be ` +
          `read as a flag, not a context.`,
      );
    }
    this.#contexts.push(name);
    return this;
  }

  /** `deno deploy env update-contexts`. */
  protected override commandPath(): string[] {
    return ["env", "update-contexts"];
  }

  /** The variable, then its contexts. */
  protected override commandArgs(): string[] {
    return [required("envUpdateContexts", this.#variable), ...this.#contexts];
  }
}

/** Settings for `deno deploy env delete`. */
export class DenoDeployEnvDeleteSettings extends DenoDeployAppSettings {
  #variable?: string;

  /** The variable to delete; required. */
  variable(name: string): this {
    this.#variable = variableName("envDelete", name);
    return this;
  }

  /** `deno deploy env delete`. */
  protected override commandPath(): string[] {
    return ["env", "delete"];
  }

  /** The variable. */
  protected override commandArgs(): string[] {
    return [required("envDelete", this.#variable)];
  }
}

/** Settings for `deno deploy env load`: load variables from a `.env` file. */
export class DenoDeployEnvLoadSettings extends DenoDeployAppSettings {
  #file?: string;
  #flags: string[] = [];
  #nonSecrets: string[] = [];

  /** The `.env` file to load; required. */
  file(path: PathLike): this {
    this.#file = pathOperand(path);
    return this;
  }

  /** A key in the file to store as a plain value, not a secret (`--non-secrets`); repeatable. */
  nonSecret(key: string): this {
    this.#nonSecrets.push(variableName("envLoad", key));
    return this;
  }

  /** Replace variables that already exist (`--replace`). */
  replace(): this {
    this.#flags.push("--replace");
    return this;
  }

  /** Keep variables that already exist (`--skip-existing`). */
  skipExisting(): this {
    this.#flags.push("--skip-existing");
    return this;
  }

  /** `deno deploy env load`. */
  protected override commandPath(): string[] {
    return ["env", "load"];
  }

  /**
   * The file, the flags, then `--non-secrets` and its keys last: the option
   * takes every argument after it, so anything placed after it would be read
   * as one more key.
   */
  protected override commandArgs(): string[] {
    if (this.#file === undefined) {
      throw new Error("DenoDeployTasks.envLoad: .file() is required.");
    }
    const nonSecrets = this.#nonSecrets.length > 0
      ? ["--non-secrets", ...this.#nonSecrets]
      : [];
    return [this.#file, ...this.#flags, ...nonSecrets];
  }
}
