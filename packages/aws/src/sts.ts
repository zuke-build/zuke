// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws sts` service — who the build is running as, and taking on a role.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * const account = await AwsTasks.accountId((s) => s.profile("deploy"));
 * await AwsTasks.stsAssumeRole((s) =>
 *   s.roleArn("arn:aws:iam::123456789012:role/deploy").roleSessionName("ci")
 * );
 * ```
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { secretsIn } from "./secret_output.ts";
import { AwsSettings } from "./settings.ts";

/** The `--query` the account-id reader pins, so the CLI extracts the field. */
export const ACCOUNT_ID_QUERY = "Account";

/** Settings for `aws sts get-caller-identity`. */
export class AwsStsGetCallerIdentitySettings extends AwsSettings {
  /** Emit `sts get-caller-identity`. */
  protected override leadingTokens(): string[] {
    return ["sts", "get-caller-identity"];
  }
}

/**
 * Settings for `aws sts assume-role`.
 *
 * The response carries a secret access key and a session token, so the
 * command always runs quietly — its output is captured, never streamed — and
 * both values are registered with the run's redactor once it returns.
 */
export class AwsStsAssumeRoleSettings extends AwsSettings {
  #roleArn?: string;
  #roleSessionName?: string;
  #durationSeconds?: number;
  #externalId?: string;
  #policy?: string;
  #serialNumber?: string;
  #tokenCode?: string;

  /** Settings that capture the credentials instead of streaming them. */
  constructor() {
    super();
    this.quiet();
  }

  /** The role to assume (`--role-arn`). */
  roleArn(arn: string): this {
    this.#roleArn = arn;
    return this;
  }

  /** An identifier for the session, shown in CloudTrail (`--role-session-name`). */
  roleSessionName(name: string): this {
    this.#roleSessionName = name;
    return this;
  }

  /** How long the credentials last, in seconds (`--duration-seconds`). */
  durationSeconds(seconds: number): this {
    this.#durationSeconds = seconds;
    return this;
  }

  /** The external id the role's trust policy requires (`--external-id`). */
  externalId(id: string): this {
    this.#externalId = id;
    return this;
  }

  /** An inline session policy, as a JSON document (`--policy`). */
  policy(json: string): this {
    this.#policy = json;
    return this;
  }

  /** The MFA device's serial number or ARN (`--serial-number`). */
  serialNumber(serial: string): this {
    this.#serialNumber = serial;
    return this;
  }

  /** The code the MFA device shows (`--token-code`). */
  tokenCode(code: string): this {
    this.#tokenCode = code;
    return this;
  }

  /** Register the returned secret access key and session token as secrets. */
  protected override onOutput(output: CommandOutput): void {
    for (const secret of secretsIn(output.stdout, CREDENTIAL_KEYS)) {
      this.markSecret(secret);
    }
  }

  /** Emit `sts assume-role` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#roleArn === undefined || this.#roleSessionName === undefined) {
      throw new Error(
        "AwsTasks.stsAssumeRole: assume-role takes a role and a session " +
          "name — add .roleArn(arn).roleSessionName('ci').",
      );
    }
    const argv = [
      "sts",
      "assume-role",
      "--role-arn",
      this.#roleArn,
      "--role-session-name",
      this.#roleSessionName,
    ];
    if (this.#durationSeconds !== undefined) {
      argv.push("--duration-seconds", String(this.#durationSeconds));
    }
    if (this.#externalId !== undefined) {
      argv.push("--external-id", this.#externalId);
    }
    if (this.#policy !== undefined) argv.push("--policy", this.#policy);
    if (this.#serialNumber !== undefined) {
      argv.push("--serial-number", this.#serialNumber);
    }
    if (this.#tokenCode !== undefined) {
      argv.push("--token-code", this.#tokenCode);
    }
    return argv;
  }
}

/** The fields of an STS `Credentials` object that are secret. */
const CREDENTIAL_KEYS = ["SecretAccessKey", "SessionToken"];
