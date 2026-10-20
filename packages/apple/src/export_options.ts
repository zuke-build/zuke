// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `ExportOptions.plist` that `xcodebuild -exportArchive` reads: typed
 * settings, rendered to the property list Xcode's Organizer would write.
 *
 * @module
 */

/**
 * How an archive is exported (`method`). Xcode 15.3 renamed three methods:
 * `app-store-connect`, `release-testing` and `debugging` were `app-store`,
 * `ad-hoc` and `development`, which older Xcode versions still require.
 */
export type ExportMethod =
  | "app-store-connect"
  | "release-testing"
  | "enterprise"
  | "debugging"
  | "developer-id"
  | "mac-application"
  | "validation"
  | "app-store"
  | "ad-hoc"
  | "development";

/** Whether Xcode or the export options pick the signing assets (`signingStyle`). */
export type ExportSigningStyle = "automatic" | "manual";

/** Whether to write the export locally or upload it to App Store Connect (`destination`). */
export type ExportDestination = "export" | "upload";

/** One value in an `ExportOptions.plist`: a string, a boolean, or a string dictionary. */
export type ExportOptionValue = string | boolean | Record<string, string>;

/**
 * `value` as property-list text: the XML special characters become entities,
 * and a character XML cannot carry — a control character, U+FFFE, U+FFFF or
 * a lone surrogate — is refused.
 */
function plistText(key: string, value: string): string {
  if (
    // deno-lint-ignore no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value) ||
    !value.isWellFormed()
  ) {
    throw new Error(
      `ExportOptions: ${key} holds a character a plist cannot carry.`,
    );
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The `<key>`/value lines for one entry, indented by `pad`. */
function entry(key: string, value: ExportOptionValue, pad: string): string[] {
  const head = `${pad}<key>${plistText("a key", key)}</key>`;
  if (typeof value === "boolean") return [head, `${pad}<${value}/>`];
  if (typeof value === "string") {
    return [head, `${pad}<string>${plistText(key, value)}</string>`];
  }
  return [
    head,
    `${pad}<dict>`,
    ...Object.entries(value).flatMap(([k, v]) => entry(k, v, `${pad}\t`)),
    `${pad}</dict>`,
  ];
}

/** Settings for an `ExportOptions.plist`. */
export class ExportOptionsSettings {
  /**
   * The options set so far, in the order each key was first set; setting a
   * key again replaces its value in place.
   */
  readonly options_: Map<string, ExportOptionValue> = new Map();

  #set(key: string, value: ExportOptionValue): this {
    this.options_.set(key, value);
    return this;
  }

  /** How the archive is exported (`method`); required. */
  method(method: ExportMethod): this {
    return this.#set("method", method);
  }

  /** The developer team id (`teamID`). */
  teamId(id: string): this {
    return this.#set("teamID", id);
  }

  /** Automatic or manual signing (`signingStyle`). */
  signingStyle(style: ExportSigningStyle): this {
    return this.#set("signingStyle", style);
  }

  /** The certificate to sign with, e.g. `Apple Distribution` (`signingCertificate`). */
  signingCertificate(name: string): this {
    return this.#set("signingCertificate", name);
  }

  /**
   * The provisioning profile, by name or UUID, for one bundle identifier
   * (`provisioningProfiles`); repeatable, once per app and extension.
   */
  provisioningProfile(bundleId: string, profile: string): this {
    const current = this.options_.get("provisioningProfiles");
    const profiles = typeof current === "object" ? current : {};
    return this.#set("provisioningProfiles", {
      ...profiles,
      [bundleId]: profile,
    });
  }

  /** Export to a directory, or upload to App Store Connect (`destination`). */
  destination(destination: ExportDestination): this {
    return this.#set("destination", destination);
  }

  /** Include symbols for crash reports (`uploadSymbols`). */
  uploadSymbols(enabled: boolean): this {
    return this.#set("uploadSymbols", enabled);
  }

  /** Let App Store Connect manage the version and build number (`manageAppVersionAndBuildNumber`). */
  manageAppVersionAndBuildNumber(enabled: boolean): this {
    return this.#set("manageAppVersionAndBuildNumber", enabled);
  }

  /** Strip Swift symbols from the binary (`stripSwiftSymbols`). */
  stripSwiftSymbols(enabled: boolean): this {
    return this.#set("stripSwiftSymbols", enabled);
  }

  /** Limit a TestFlight upload to internal testers (`testFlightInternalTestingOnly`). */
  testFlightInternalTestingOnly(enabled: boolean): this {
    return this.#set("testFlightInternalTestingOnly", enabled);
  }

  /**
   * The property list, as `xcodebuild -exportArchive -exportOptionsPlist`
   * reads it. Pure: no I/O.
   *
   * @throws {Error} when no {@link method} is set, or a value holds a control
   *   character a plist cannot carry.
   */
  render(): string {
    if (!this.options_.has("method")) {
      throw new Error("ExportOptions: .method() is required.");
    }
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
      '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      ...[...this.options_].flatMap(([key, value]) => entry(key, value, "\t")),
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
  }
}
