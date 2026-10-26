// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a provisioning profile says about itself. A `.mobileprovision` is a
 * CMS (PKCS #7) envelope around an XML property list; the plist is stored
 * as-is inside it, so it is read straight from the bytes, with no `security`
 * subprocess and on any operating system. The envelope's signature is not
 * verified here — Xcode verifies it when it uses the profile.
 *
 * @module
 */

import { ProvisioningProfileError } from "./errors.ts";
import { parsePlist, type PlistDict, type PlistValue } from "./plist.ts";
import { messageOf } from "./text.ts";

/**
 * How a profile distributes the app, as Xcode's Organizer names it:
 * `development` (devices listed, debugging allowed), `ad-hoc` (devices
 * listed), `enterprise` (all devices) or `app-store` (no devices — App Store
 * and TestFlight).
 */
export type ProvisioningProfileKind =
  | "development"
  | "ad-hoc"
  | "enterprise"
  | "app-store";

/** A provisioning profile's identity, as read from the profile itself. */
export interface ProvisioningProfile {
  /** The profile's UUID — Xcode installs it as `<uuid>.mobileprovision`. */
  readonly uuid: string;
  /** The profile's name, as `ExportOptions.plist` can refer to it. */
  readonly name: string;
  /** The team ids it belongs to. */
  readonly teamIds: readonly string[];
  /** The team's name. */
  readonly teamName: string;
  /** The App ID's name. */
  readonly appIdName: string;
  /**
   * The bundle identifier it signs, e.g. `com.example.app`, or a wildcard
   * such as `com.example.*` — the `application-identifier` entitlement
   * without its team prefix.
   */
  readonly bundleId: string;
  /** The platforms it is for, e.g. `["iOS"]`. */
  readonly platforms: readonly string[];
  /** How it distributes the app. */
  readonly kind: ProvisioningProfileKind;
  /** When it was created. */
  readonly creationDate: Date;
  /** When it expires. */
  readonly expirationDate: Date;
  /** Whether Xcode created and manages it (automatic signing). */
  readonly xcodeManaged: boolean;
}

const PLIST_START = new TextEncoder().encode("<?xml");
const PLIST_END = new TextEncoder().encode("</plist>");

/** The index of `needle` in `haystack` at or after `from`, or -1. */
function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function field(dict: PlistDict, key: string): PlistValue {
  const value = dict[key];
  if (value === undefined) {
    throw new ProvisioningProfileError(`the profile has no ${key}.`);
  }
  return value;
}

function text(dict: PlistDict, key: string): string {
  const value = field(dict, key);
  if (typeof value !== "string") {
    throw new ProvisioningProfileError(`the profile's ${key} is not a string.`);
  }
  return value;
}

function date(dict: PlistDict, key: string): Date {
  const value = field(dict, key);
  if (!(value instanceof Date)) {
    throw new ProvisioningProfileError(`the profile's ${key} is not a date.`);
  }
  return value;
}

function texts(dict: PlistDict, key: string): string[] {
  const value = field(dict, key);
  const strings = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
  if (!Array.isArray(value) || strings.length !== value.length) {
    throw new ProvisioningProfileError(
      `the profile's ${key} is not a list of strings.`,
    );
  }
  return strings;
}

function isDict(value: PlistValue | undefined): value is PlistDict {
  return typeof value === "object" && !(value instanceof Date) &&
    !(value instanceof Uint8Array) && !Array.isArray(value);
}

function kindOf(
  profile: PlistDict,
  entitlements: PlistDict,
): ProvisioningProfileKind {
  if (profile.ProvisionsAllDevices === true) return "enterprise";
  if (profile.ProvisionedDevices === undefined) return "app-store";
  return entitlements["get-task-allow"] === true ? "development" : "ad-hoc";
}

/**
 * Read a provisioning profile's identity from the bytes of a
 * `.mobileprovision`.
 *
 * @throws {ProvisioningProfileError} when the bytes hold no property list, or
 *   the property list lacks a field every profile has.
 */
export function readProvisioningProfile(
  bytes: Uint8Array,
): ProvisioningProfile {
  const start = indexOf(bytes, PLIST_START);
  const end = start < 0 ? -1 : indexOf(bytes, PLIST_END, start);
  if (end < 0) {
    throw new ProvisioningProfileError(
      "no property list found — is this a .mobileprovision file?",
    );
  }
  let root: PlistValue;
  try {
    root = parsePlist(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(start, end + PLIST_END.length),
      ),
    );
  } catch (error) {
    throw new ProvisioningProfileError(messageOf(error), { cause: error });
  }
  if (!isDict(root)) {
    throw new ProvisioningProfileError(
      "the property list is not a dictionary.",
    );
  }
  const entitlements = root.Entitlements;
  if (!isDict(entitlements)) {
    throw new ProvisioningProfileError("the profile has no Entitlements.");
  }
  const appId = text(entitlements, "application-identifier");
  const dot = appId.indexOf(".");
  return {
    uuid: text(root, "UUID"),
    name: text(root, "Name"),
    teamIds: texts(root, "TeamIdentifier"),
    teamName: text(root, "TeamName"),
    appIdName: text(root, "AppIDName"),
    bundleId: dot < 0 ? appId : appId.slice(dot + 1),
    platforms: texts(root, "Platform"),
    kind: kindOf(root, entitlements),
    creationDate: date(root, "CreationDate"),
    expirationDate: date(root, "ExpirationDate"),
    xcodeManaged: root.IsXcodeManaged === true,
  };
}
