// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az keyvault secret` — reading and writing a Key Vault secret.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * const password = await AzTasks.secretValue((s) =>
 *   s.vaultName("kv-prod").name("db-password")
 * );
 * await AzTasks.keyvaultSecretSet((s) =>
 *   s.vaultName("kv-prod").name("tls-cert").file("cert.pem")
 * );
 * ```
 *
 * Both commands print the secret's value, so both run quietly — captured,
 * never streamed — with `--output json` pinned, and the value they return is
 * registered with the run's redactor, as are a JSON secret's credential-named
 * fields.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { registerSecrets } from "./secret_output.ts";
import { type AzOutputFormat, AzSettings } from "./settings.ts";
import { type AzTime, utcSeconds } from "./time.ts";
import { bool, fromStdin, option, pair } from "./validate.ts";

/** The `--query` the secret reader pins: the value field. */
export const SECRET_VALUE_QUERY = "value";

/** The encodings `keyvault secret set --encoding` accepts for a file. */
export type AzKeyvaultSecretEncoding =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "ascii"
  | "base64"
  | "hex";

/** `--vault-name` and `--name`, or `--id`; refused when neither is complete. */
function secretTokens(
  task: string,
  vault: string | undefined,
  name: string | undefined,
  id: string | undefined,
): string[] {
  if (id !== undefined) return [option("--id", id)];
  if (vault === undefined || name === undefined) {
    throw new Error(
      `AzTasks.${task}: no secret named — add .vaultName('kv').name('secret'), ` +
        "or .id(secretIdentifier).",
    );
  }
  return [option("--vault-name", vault), option("--name", name)];
}

/** Settings for `az keyvault secret show`. */
export class AzKeyvaultSecretShowSettings extends AzSettings {
  #vaultName?: string;
  #name?: string;
  #version?: string;
  #id?: string;

  /** Settings that capture the secret instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The vault's name (`--vault-name`). */
  vaultName(name: string): this {
    this.#vaultName = name;
    return this;
  }

  /** The secret's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** A specific version; the latest when omitted (`--version`). */
  version(version: string): this {
    this.#version = version;
    return this;
  }

  /** The secret's full identifier, instead of vault and name (`--id`). */
  id(identifier: string): this {
    this.#id = identifier;
    return this;
  }

  /** Pin `--output json`, the form the returned value can be found in. */
  protected override pinnedOutput(): AzOutputFormat {
    return "json";
  }

  /** Register the returned value as a secret. */
  protected override onOutput(output: CommandOutput): void {
    registerSecrets(
      output.stdout,
      [SECRET_VALUE_QUERY],
      this.queried,
      (secret) => this.markSecret(secret),
    );
  }

  /** Emit `keyvault secret show` with its options. */
  protected override leadingTokens(): string[] {
    const argv = [
      "keyvault",
      "secret",
      "show",
      ...secretTokens(
        "keyvaultSecretShow",
        this.#vaultName,
        this.#name,
        this.#id,
      ),
    ];
    if (this.#version !== undefined) {
      argv.push(option("--version", this.#version));
    }
    return argv;
  }
}

/**
 * Settings for `az keyvault secret set`.
 *
 * The value comes from a {@link file} — read exactly, with its
 * {@link encoding} — or from {@link value}, which is sent on standard input
 * as `--value=@-` so it never enters the argv. The CLI strips trailing line
 * breaks from what it reads that way; use a file for a value that must keep
 * them.
 */
export class AzKeyvaultSecretSetSettings extends AzSettings {
  #vaultName?: string;
  #name?: string;
  #value?: string;
  #file?: string;
  #encoding?: AzKeyvaultSecretEncoding;
  #contentType?: string;
  #expires?: string;
  #notBefore?: string;
  #disabled?: boolean;
  readonly #tags: string[] = [];

  /** Settings that capture the answer, which carries the value, instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The vault's name (`--vault-name`). */
  vaultName(name: string): this {
    this.#vaultName = name;
    return this;
  }

  /** The secret's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /**
   * The value, sent on standard input as `--value=@-` and registered with the
   * run's redactor.
   */
  value(secret: string): this {
    this.#value = secret;
    this.markSecret(secret);
    return this;
  }

  /** Read the value from a file (`--file`) — the way to keep it exact. */
  file(path: string): this {
    this.#file = path;
    return this;
  }

  /**
   * How the {@link file} is encoded (`--encoding`); `utf-8` by default.
   * Refused without a file: the CLI saves it as a `file-encoding` tag that
   * `keyvault secret download` later decodes with.
   */
  encoding(encoding: AzKeyvaultSecretEncoding): this {
    this.#encoding = encoding;
    return this;
  }

  /** What the value is, e.g. `"password"` (`--content-type`). */
  contentType(type: string): this {
    this.#contentType = type;
    return this;
  }

  /**
   * When the secret expires (`--expires`): a `Date`, or a string such as
   * `2027-01-01T00:00:00Z` — the CLI takes UTC to the second, no fractions.
   */
  expires(time: AzTime): this {
    this.#expires = utcSeconds(time);
    return this;
  }

  /** When the secret becomes usable (`--not-before`), in the same form as {@link expires}. */
  notBefore(time: AzTime): this {
    this.#notBefore = utcSeconds(time);
    return this;
  }

  /** Create the secret disabled, or enabled (`--disabled`). */
  disabled(value: boolean): this {
    this.#disabled = value;
    return this;
  }

  /** A tag (`--tags key=value`); repeatable. */
  tag(key: string, value: string): this {
    this.#tags.push(pair("keyvaultSecretSet", "tag", key, value));
    return this;
  }

  /** Pin `--output json`, the form the returned value can be found in. */
  protected override pinnedOutput(): AzOutputFormat {
    return "json";
  }

  /** The value, for the CLI to read from standard input. */
  protected override stdinInput(): string | undefined {
    return this.#value;
  }

  /** Register the returned value as a secret. */
  protected override onOutput(output: CommandOutput): void {
    registerSecrets(
      output.stdout,
      [SECRET_VALUE_QUERY],
      this.queried,
      (secret) => this.markSecret(secret),
    );
  }

  /** Emit `keyvault secret set` with its options. */
  protected override leadingTokens(): string[] {
    const task = "keyvaultSecretSet";
    if ((this.#value === undefined) === (this.#file === undefined)) {
      throw new Error(
        `AzTasks.${task}: set takes one value — add .file(path) or ` +
          ".value(secret).",
      );
    }
    const argv = [
      "keyvault",
      "secret",
      "set",
      ...secretTokens(task, this.#vaultName, this.#name, undefined),
    ];
    if (this.#value !== undefined) argv.push(fromStdin("--value"));
    if (this.#file !== undefined) argv.push(option("--file", this.#file));
    if (this.#encoding !== undefined) {
      if (this.#file === undefined) {
        throw new Error(
          `AzTasks.${task}: --encoding describes a --file — without one the ` +
            "CLI still stores it as the secret's file-encoding tag, and a " +
            "later download decodes the value with it. Add .file(path) or " +
            "drop .encoding(...).",
        );
      }
      argv.push(option("--encoding", this.#encoding));
    }
    if (this.#contentType !== undefined) {
      argv.push(option("--content-type", this.#contentType));
    }
    if (this.#expires !== undefined) {
      argv.push(option("--expires", this.#expires));
    }
    if (this.#notBefore !== undefined) {
      argv.push(option("--not-before", this.#notBefore));
    }
    if (this.#disabled !== undefined) {
      argv.push(bool("--disabled", this.#disabled));
    }
    if (this.#tags.length > 0) argv.push("--tags", ...this.#tags);
    return argv;
  }
}
