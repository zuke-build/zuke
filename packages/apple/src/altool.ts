// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `AltoolTasks` — upload or validate an app with `xcrun altool`.
 *
 * ```ts
 * import { AltoolTasks } from "@zuke/apple";
 * await AltoolTasks.uploadApp((s) =>
 *   s.file("build/ipa/App.ipa").type("ios").apiKey("ABC123", issuerId)
 *     .apiPrivateKeysDir("secrets")
 * );
 * ```
 *
 * Apple has deprecated `altool` in favour of `xcodebuild -exportArchive` with
 * an `ExportOptions.plist` whose `destination` is `upload` — see
 * `XcodebuildTasks` — but it still uploads, and many pipelines use it.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { operand } from "./operand.ts";

/** The platform of the app being uploaded (`--type`). */
export type AltoolPlatform = "ios" | "macos" | "appletvos" | "visionos";

/** The `altool` operations this wrapper runs. */
export type AltoolOperation = "--upload-app" | "--validate-app";

/** The environment variable the app-specific password is passed in. */
const PASSWORD_ENV = "ZUKE_ALTOOL_PASSWORD";

/** Settings for `xcrun altool --upload-app` and `--validate-app`. */
export class AltoolSettings extends ToolSettings {
  readonly #operation: AltoolOperation;
  #file?: string;
  #type?: AltoolPlatform;
  #auth: string[] = [];

  /** Settings for `xcrun altool <operation>`. */
  constructor(operation: AltoolOperation) {
    super();
    this.#operation = operation;
  }

  /** The default executable name (`xcrun`), which dispatches to altool. */
  protected override defaultTool(): string {
    return "xcrun";
  }

  /** Resolve from `PATH` — `xcrun` ships with macOS in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** The `.ipa` or `.pkg` to upload or validate (`--file`); required. */
  file(path: PathLike): this {
    this.#file = operand(path);
    return this;
  }

  /** The app's platform (`--type`); required. */
  type(platform: AltoolPlatform): this {
    this.#type = platform;
    return this;
  }

  /**
   * Authenticate with an App Store Connect API key: its key id and issuer id
   * (`--apiKey`, `--apiIssuer`). `altool` finds `AuthKey_<keyId>.p8` in
   * `~/.appstoreconnect/private_keys` and its other search directories, or in
   * {@link apiPrivateKeysDir}.
   */
  apiKey(keyId: string, issuerId: string): this {
    this.#auth = ["--apiKey", keyId, "--apiIssuer", issuerId];
    return this;
  }

  /**
   * The directory holding `AuthKey_<keyId>.p8`, passed to `altool` as
   * `API_PRIVATE_KEYS_DIR`.
   */
  apiPrivateKeysDir(path: PathLike): this {
    return this.env({ API_PRIVATE_KEYS_DIR: String(path) });
  }

  /**
   * Authenticate with an Apple ID and an app-specific password
   * (`--username`, `--password`). The password is handed to `altool` in an
   * environment variable it reads through `@env:`, so it is never on the
   * command line, and it is registered with the run's redactor.
   */
  appleId(username: string, password: string): this {
    this.markSecret(password);
    this.env({ [PASSWORD_ENV]: password });
    this.#auth = ["--username", username, "--password", `@env:${PASSWORD_ENV}`];
    return this;
  }

  /** Assemble the `altool` argv; the output is always JSON. */
  protected override buildArgs(): string[] {
    if (this.#file === undefined || this.#type === undefined) {
      throw new Error(
        `altool ${this.#operation}: .file() and .type() are required.`,
      );
    }
    if (this.#auth.length === 0) {
      throw new Error(
        `altool ${this.#operation}: authenticate with .apiKey() or .appleId().`,
      );
    }
    return [
      "altool",
      this.#operation,
      "--file",
      this.#file,
      "--type",
      this.#type,
      ...this.#auth,
      "--output-format",
      "json",
    ];
  }
}

/** The shape of {@link AltoolTasks}. */
export interface AltoolTasksApi {
  /** Upload an app to App Store Connect: `xcrun altool --upload-app`. */
  uploadApp(configure: Configure<AltoolSettings>): Promise<CommandOutput>;
  /** Validate an app without uploading it: `xcrun altool --validate-app`. */
  validateApp(configure: Configure<AltoolSettings>): Promise<CommandOutput>;
}

/** Typed task functions for `xcrun altool`. */
export const AltoolTasks: AltoolTasksApi = {
  uploadApp: (configure) =>
    runSettings(new AltoolSettings("--upload-app"), configure),
  validateApp: (configure) =>
    runSettings(new AltoolSettings("--validate-app"), configure),
};
