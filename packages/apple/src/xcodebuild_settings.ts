// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases every `xcodebuild` settings class builds on: the binary and the
 * flags every invocation takes (provisioning, the App Store Connect API key,
 * `-quiet`), and the project flags every build action takes (workspace or
 * project, scheme, configuration, SDK, destinations, paths and build
 * settings).
 *
 * @module
 */

import {
  type PathLike,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import { operand } from "./operand.ts";

/** Base for all `xcodebuild` settings: the binary is `xcodebuild`, on `PATH`. */
export abstract class XcodebuildSettings extends ToolSettings {
  #common: string[] = [];

  /** The default executable name (`xcodebuild`). */
  protected override defaultTool(): string {
    return "xcodebuild";
  }

  /** Resolve from `PATH` — `xcodebuild` ships with Xcode in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** The invocation's own arguments, placed after the shared flags. */
  protected abstract invocationArgs(): string[];

  /** Print only warnings and errors (`-quiet`). */
  quietOutput(): this {
    this.#common.push("-quiet");
    return this;
  }

  /**
   * Let Xcode create and update provisioning profiles and certificates
   * (`-allowProvisioningUpdates`); on CI, pair it with
   * {@link authenticationKey}.
   */
  allowProvisioningUpdates(): this {
    this.#common.push("-allowProvisioningUpdates");
    return this;
  }

  /**
   * Sign in to the developer account with an App Store Connect API key
   * instead of an Xcode account: the `AuthKey_<id>.p8` file, its key id and
   * its issuer id (`-authenticationKeyPath`, `-authenticationKeyID`,
   * `-authenticationKeyIssuerID`).
   */
  authenticationKey(path: PathLike, keyId: string, issuerId: string): this {
    this.#common.push(
      "-authenticationKeyPath",
      operand(path),
      "-authenticationKeyID",
      keyId,
      "-authenticationKeyIssuerID",
      issuerId,
    );
    return this;
  }

  /** Assemble the argv: the invocation's arguments, then the shared flags. */
  protected override buildArgs(): string[] {
    return [...this.invocationArgs(), ...this.#common];
  }
}

/** `name` if it is a build setting name, else a friendly error. */
function settingName(name: string): string {
  // A plain name, optionally with a condition: CODE_SIGN_IDENTITY[sdk=iphoneos*].
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]\s]+\])*$/.test(name)) {
    throw new Error(
      `xcodebuild: ${JSON.stringify(name)} is not a build setting name.`,
    );
  }
  return name;
}

/**
 * The project flags every build action takes. Each action names itself and
 * its own flags; the project flags come first, then the action, then the
 * build settings.
 */
export abstract class XcodebuildProjectSettings extends XcodebuildSettings {
  #container?: string[];
  #scheme?: string;
  #configuration?: string;
  #sdk?: string;
  #project: string[] = [];
  #settings: string[] = [];

  /** The action and its own flags, e.g. `["archive", "-archivePath", …]`. */
  protected abstract actionArgs(): string[];

  #setContainer(flag: string, path: PathLike): this {
    if (this.#container !== undefined) {
      throw new Error(
        "xcodebuild: set one of .workspace() and .project(), not both.",
      );
    }
    this.#container = [flag, operand(path)];
    return this;
  }

  /** The workspace to build, e.g. `App.xcworkspace` (`-workspace`). */
  workspace(path: PathLike): this {
    return this.#setContainer("-workspace", path);
  }

  /** The project to build, e.g. `App.xcodeproj` (`-project`). */
  project(path: PathLike): this {
    return this.#setContainer("-project", path);
  }

  /** The scheme to build (`-scheme`); required with a workspace. A later call replaces it. */
  scheme(name: string): this {
    this.#scheme = name;
    return this;
  }

  /** The build configuration, e.g. `Release` (`-configuration`). A later call replaces it. */
  configuration(name: string): this {
    this.#configuration = name;
    return this;
  }

  /** The SDK, e.g. `iphoneos` or `iphonesimulator` (`-sdk`). A later call replaces it. */
  sdk(name: string): this {
    this.#sdk = name;
    return this;
  }

  /**
   * A destination, e.g. `generic/platform=iOS` or
   * `platform=iOS Simulator,name=iPhone 16` (`-destination`); repeatable.
   */
  destination(specifier: string): this {
    this.#project.push("-destination", specifier);
    return this;
  }

  /** Where intermediate build files go (`-derivedDataPath`). */
  derivedDataPath(path: PathLike): this {
    this.#project.push("-derivedDataPath", operand(path));
    return this;
  }

  /** Where Swift packages are checked out (`-clonedSourcePackagesDirPath`). */
  clonedSourcePackagesDirPath(path: PathLike): this {
    this.#project.push("-clonedSourcePackagesDirPath", operand(path));
    return this;
  }

  /** Write an `.xcresult` bundle with the logs and results (`-resultBundlePath`). */
  resultBundlePath(path: PathLike): this {
    this.#project.push("-resultBundlePath", operand(path));
    return this;
  }

  /** Apply an `.xcconfig` file's settings over every target (`-xcconfig`). */
  xcconfig(path: PathLike): this {
    this.#project.push("-xcconfig", operand(path));
    return this;
  }

  /**
   * Override a build setting for every target, e.g.
   * `("DEVELOPMENT_TEAM", "ABCDE12345")` → `DEVELOPMENT_TEAM=ABCDE12345`;
   * repeatable. A condition goes in the name:
   * `CODE_SIGN_IDENTITY[sdk=iphoneos*]`.
   */
  buildSetting(name: string, value: string): this {
    this.#settings.push(`${settingName(name)}=${value}`);
    return this;
  }

  /** The project flags, the action, then the build settings. */
  protected override invocationArgs(): string[] {
    const single: string[] = [];
    if (this.#scheme !== undefined) single.push("-scheme", this.#scheme);
    if (this.#configuration !== undefined) {
      single.push("-configuration", this.#configuration);
    }
    if (this.#sdk !== undefined) single.push("-sdk", this.#sdk);
    return [
      ...(this.#container ?? []),
      ...single,
      ...this.#project,
      ...this.actionArgs(),
      ...this.#settings,
    ];
  }
}
