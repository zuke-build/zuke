// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws ssm` Parameter Store commands — reading and writing a parameter.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * const url = await AwsTasks.parameterValue((s) => s.name("/api/db-url"));
 * await AwsTasks.ssmPutParameter((s) =>
 *   s.name("/api/token").type("SecureString").valueFile("token.txt").overwrite()
 * );
 * ```
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { secretsIn } from "./secret_output.ts";
import { type AwsOutputFormat, AwsSettings } from "./settings.ts";
import { freeText, option } from "./validate.ts";

/** The `--query` the parameter reader pins, so the CLI extracts the field. */
export const PARAMETER_VALUE_QUERY = "Parameter.Value";

/** The kinds of parameter Parameter Store keeps. */
export type AwsSsmParameterType = "String" | "StringList" | "SecureString";

/**
 * Settings for `aws ssm get-parameter`.
 *
 * A parameter may be a `SecureString`, so the command always runs quietly —
 * captured, never streamed — with `--output json` pinned, and the value it
 * returns is registered with the run's redactor.
 */
export class AwsSsmGetParameterSettings extends AwsSettings {
  #name?: string;
  #withDecryption = false;

  /** Settings that capture the value instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The parameter's name or ARN (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * Return a `SecureString` decrypted (`--with-decryption`). Without it, a
   * `SecureString` comes back as ciphertext.
   */
  withDecryption(): this {
    this.#withDecryption = true;
    return this;
  }

  /** Pin `--output json`, the form the returned secrets can be found in. */
  protected override pinnedOutput(): AwsOutputFormat {
    return "json";
  }

  /** Register the returned value as a secret. */
  protected override onOutput(output: CommandOutput): void {
    for (const secret of secretsIn(output.stdout, ["Value"])) {
      this.markSecret(secret);
    }
  }

  /** Emit `ssm get-parameter` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "AwsTasks.ssmGetParameter: no parameter named — add " +
          ".name('/api/db-url').",
      );
    }
    const argv = ["ssm", "get-parameter", option("--name", this.#name)];
    if (this.#withDecryption) argv.push("--with-decryption");
    return argv;
  }
}

/**
 * Settings for `aws ssm put-parameter`.
 *
 * `--value` is a command-line argument, which every user on the host can read
 * from the process table. For a `SecureString`, write the value to a file
 * with owner-only permissions and use {@link valueFile}: the CLI reads it, so
 * it never appears in the argv. A literal {@link value} given to a
 * `SecureString` is registered with the run's redactor, which masks Zuke's
 * own output but not the process table.
 */
export class AwsSsmPutParameterSettings extends AwsSettings {
  #name?: string;
  #value?: string;
  #type?: AwsSsmParameterType;
  #overwrite = false;
  #keyId?: string;
  #description?: string;
  #tier?: "Standard" | "Advanced" | "Intelligent-Tiering";
  #dataType?: string;

  /** The parameter's name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * The value, given literally (`--value`). Refuses a value starting with
   * `file://` or `fileb://`: the CLI would read the named file rather than
   * store the text — use {@link valueFile} when that is the intent.
   */
  value(text: string): this {
    this.#value = freeText("ssmPutParameter", "--value", text);
    this.#markIfSecure();
    return this;
  }

  /**
   * Read the value from a file (`--value=file://<path>`), which keeps it off
   * the command line. The CLI stores the file's contents exactly, trailing
   * newline included.
   */
  valueFile(path: string): this {
    this.#value = `file://${path}`;
    return this;
  }

  /** The parameter's type (`--type`). */
  type(value: AwsSsmParameterType): this {
    this.#type = value;
    this.#markIfSecure();
    return this;
  }

  /** Replace an existing parameter (`--overwrite`). */
  overwrite(): this {
    this.#overwrite = true;
    return this;
  }

  /** The KMS key that encrypts a `SecureString` (`--key-id`). */
  keyId(id: string): this {
    this.#keyId = id;
    return this;
  }

  /** A description of the parameter (`--description`). */
  description(text: string): this {
    this.#description = freeText("ssmPutParameter", "--description", text);
    return this;
  }

  /** The storage tier (`--tier`). */
  tier(value: "Standard" | "Advanced" | "Intelligent-Tiering"): this {
    this.#tier = value;
    return this;
  }

  /** The data type (`--data-type`), e.g. `"aws:ec2:image"`. */
  dataType(value: string): this {
    this.#dataType = value;
    return this;
  }

  /** Register a literal `SecureString` value as a secret. */
  #markIfSecure(): void {
    if (
      this.#type === "SecureString" && this.#value !== undefined &&
      !this.#value.startsWith("file://")
    ) {
      this.markSecret(this.#value);
    }
  }

  /** Emit `ssm put-parameter` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined || this.#value === undefined) {
      throw new Error(
        "AwsTasks.ssmPutParameter: a put needs a name and a value — add " +
          ".name('/api/token') and .valueFile(path) or .value(text).",
      );
    }
    // `--value=<v>` rather than two tokens: the CLI's parser reads a value
    // that starts with `-` as the next option, so a password beginning with a
    // hyphen would otherwise be refused as a missing argument.
    const argv = [
      "ssm",
      "put-parameter",
      option("--name", this.#name),
      `--value=${this.#value}`,
    ];
    if (this.#type !== undefined) argv.push(option("--type", this.#type));
    if (this.#overwrite) argv.push("--overwrite");
    if (this.#keyId !== undefined) argv.push(option("--key-id", this.#keyId));
    if (this.#description !== undefined) {
      argv.push(option("--description", this.#description));
    }
    if (this.#tier !== undefined) argv.push(option("--tier", this.#tier));
    if (this.#dataType !== undefined) {
      argv.push(option("--data-type", this.#dataType));
    }
    return argv;
  }
}
