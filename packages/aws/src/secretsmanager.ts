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
import { AwsSettings } from "./settings.ts";

/** The `--query` the secret reader pins, so the CLI extracts the field. */
export const SECRET_STRING_QUERY = "SecretString";

/**
 * Settings for `aws secretsmanager get-secret-value`.
 *
 * The response is the secret, so the command always runs quietly — captured,
 * never streamed — and the `SecretString` it returns is registered with the
 * run's redactor.
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

  /** Register the returned `SecretString` as a secret. */
  protected override onOutput(output: CommandOutput): void {
    for (const secret of secretsIn(output.stdout, [SECRET_STRING_QUERY])) {
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
      "--secret-id",
      this.#secretId,
    ];
    if (this.#versionId !== undefined) {
      argv.push("--version-id", this.#versionId);
    }
    if (this.#versionStage !== undefined) {
      argv.push("--version-stage", this.#versionStage);
    }
    return argv;
  }
}
