// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link SecretOutputSettings}: how a wrapper describes a credential-bearing
 * command's output to `ToolSettings.markSecretsInOutput`. Re-exported from the
 * `./tooling` entrypoint.
 *
 * @module
 */

/**
 * What a wrapper knows about the output of a command that prints a secret —
 * which field the secret comes back under, and whether the caller reshaped the
 * answer — configured through the lambda handed to
 * `ToolSettings.markSecretsInOutput`:
 *
 * ```ts
 * protected override onOutput(output: CommandOutput): void {
 *   this.markSecretsInOutput(output.stdout, (s) =>
 *     s.keys("SecretString", "SecretBinary").queried(this.queried));
 * }
 * ```
 *
 * Neither setting is required: with no keys, a JSON answer has every scalar of
 * eight or more characters registered, and an answer that is not JSON (a bare
 * token) is registered whole.
 */
export class SecretOutputSettings {
  /** The field names the command returns its secret under; see {@link keys}. */
  keys_: string[] = [];

  /** Whether the caller reshaped the output; see {@link queried}. */
  queried_ = false;

  /**
   * The field names the command returns its secret under, at any depth of the
   * JSON it prints — `SecretString`, `accessToken`, `value`. A string found
   * under one is registered whatever its length, since it *is* the secret.
   * Accumulates across calls.
   */
  keys(...names: string[]): this {
    this.keys_.push(...names);
    return this;
  }

  /**
   * Whether the caller passed a query (`--query`, a JMESPath projection) that
   * may have reshaped the output — renamed a key, or moved the secret under
   * another. When it did, the expected keys are no longer trusted to hold the
   * secret: every scalar of eight or more characters in the answer is
   * registered, and a short value under an expected key is treated like any
   * other derived value — `{accessToken: tokenType}` must not register
   * `Bearer`.
   */
  queried(reshaped: boolean): this {
    this.queried_ = reshaped;
    return this;
  }
}
