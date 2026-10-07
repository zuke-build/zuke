// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws configure` command — reading and writing the CLI's own settings in
 * the shared config and credentials files.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.configureSet((s) => s.varname("region").value("eu-west-1"));
 * await AwsTasks.configureGet((s) => s.varname("region").profile("deploy"));
 * ```
 *
 * The profile both act on is the global `.profile(...)`.
 *
 * @module
 */

import { AwsSettings } from "./settings.ts";

/** The settings `aws configure set` writes to the credentials file. */
const SECRET_SETTINGS = ["aws_secret_access_key", "aws_session_token"];

/** Settings for `aws configure get`. */
export class AwsConfigureGetSettings extends AwsSettings {
  #varname?: string;

  /** The setting to read (positional), e.g. `"region"`. */
  varname(name: string): this {
    this.#varname = name;
    return this;
  }

  /** Emit `configure get` with the setting. */
  protected override leadingTokens(): string[] {
    if (this.#varname === undefined) {
      throw new Error(
        "AwsTasks.configureGet: no setting named — add .varname('region').",
      );
    }
    return ["configure", "get", this.#varname];
  }
}

/**
 * Settings for `aws configure set`.
 *
 * `aws configure set` takes the value on its command line, where every user
 * on the host can read it from the process table. Setting
 * `aws_secret_access_key` or `aws_session_token` this way registers the value
 * with the run's redactor so Zuke's own output masks it, but that does not
 * hide it from the process table — prefer the `AWS_*` environment variables
 * or a role for credentials.
 */
export class AwsConfigureSetSettings extends AwsSettings {
  #varname?: string;
  #value?: string;

  /** The setting to write (positional), e.g. `"region"`. */
  varname(name: string): this {
    this.#varname = name;
    this.#markIfSecret();
    return this;
  }

  /** The value to write (positional). */
  value(text: string): this {
    this.#value = text;
    this.#markIfSecret();
    return this;
  }

  /** Register the value as a secret when the setting is a credential. */
  #markIfSecret(): void {
    if (
      this.#value !== undefined && this.#varname !== undefined &&
      SECRET_SETTINGS.includes(this.#varname.toLowerCase())
    ) {
      this.markSecret(this.#value);
    }
  }

  /** Emit `configure set` with the setting and value. */
  protected override leadingTokens(): string[] {
    if (this.#varname === undefined || this.#value === undefined) {
      throw new Error(
        "AwsTasks.configureSet: configure set takes a setting and a value " +
          "— add .varname('region').value('eu-west-1').",
      );
    }
    return ["configure", "set", this.#varname, this.#value];
  }
}
