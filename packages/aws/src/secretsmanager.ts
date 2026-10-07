// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws secretsmanager` service — reading a secret's value.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * const password = await AwsTasks.secretString((s) => s.secretId("prod/db"));
 * ```
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { secretsIn } from "./secret_output.ts";
import { option } from "./validate.ts";
import { type AwsOutputFormat, AwsSettings } from "./settings.ts";

/** The `--query` the secret reader pins, so the CLI extracts the field. */
export const SECRET_STRING_QUERY = "SecretString";

/** The fields of a `get-secret-value` response that hold the secret. */
const SECRET_KEYS = [SECRET_STRING_QUERY, "SecretBinary"];

/**
 * Settings for `aws secretsmanager get-secret-value`.
 *
 * The response is the secret, so the command always runs quietly — captured,
 * never streamed — with `--output json` pinned, and the `SecretString` or
 * `SecretBinary` it returns is registered with the run's redactor.
 */
export class AwsSecretsmanagerGetSecretValueSettings extends AwsSettings {
  #secretId?: string;
  #versionId?: string;
  #versionStage?: string;

  /** Settings that capture the secret instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The secret's name or ARN (`--secret-id`). */
  secretId(id: string): this {
    this.#secretId = id;
    return this;
  }

  /** A specific version, by id (`--version-id`). */
  versionId(id: string): this {
    this.#versionId = id;
    return this;
  }

  /** A specific version, by staging label (`--version-stage`); `AWSCURRENT` by default. */
  versionStage(label: string): this {
    this.#versionStage = label;
    return this;
  }

  /** Pin `--output json`, the form the returned secrets can be found in. */
  protected override pinnedOutput(): AwsOutputFormat {
    return "json";
  }

  /** Register the returned `SecretString` or `SecretBinary` as a secret. */
  protected override onOutput(output: CommandOutput): void {
    for (const secret of secretsIn(output.stdout, SECRET_KEYS)) {
      this.markSecret(secret);
    }
  }

  /** Emit `secretsmanager get-secret-value` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#secretId === undefined) {
      throw new Error(
        "AwsTasks.secretsmanagerGetSecretValue: no secret named — add " +
          ".secretId('prod/db').",
      );
    }
    const argv = [
      "secretsmanager",
      "get-secret-value",
      option("--secret-id", this.#secretId),
    ];
    if (this.#versionId !== undefined) {
      argv.push(option("--version-id", this.#versionId));
    }
    if (this.#versionStage !== undefined) {
      argv.push(option("--version-stage", this.#versionStage));
    }
    return argv;
  }
}
