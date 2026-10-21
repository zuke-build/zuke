// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `TestFlightTasks.distribute`.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import { AppStoreConnectSettings } from "./app_store_connect.ts";

/** The platform of a build, as App Store Connect names it. */
export type TestFlightPlatform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS";

/** `ms` if it is a whole number of ms from `min` up, else a friendly error. */
function wholeMs(name: string, ms: number, min: number): number {
  if (!Number.isSafeInteger(ms) || ms < min) {
    throw new Error(
      `TestFlightTasks.distribute: .${name}() must be at least ${min} ms, ` +
        `not ${ms}.`,
    );
  }
  return ms;
}

/** Settings for `TestFlightTasks.distribute`. */
export class TestFlightSettings extends AppStoreConnectSettings {
  /** The app's bundle id (set by {@link bundleId}). */
  bundleId_?: string;
  /** The build number (set by {@link buildNumber}). */
  buildNumber_?: string;
  /** The version (set by {@link version}). */
  version_?: string;
  /** The platform (set by {@link platform}). */
  platform_?: TestFlightPlatform;
  /** The longest wait for processing, in ms (set by {@link timeout}). */
  timeout_: number = 30 * 60 * 1000;
  /** The time between two polls, in ms (set by {@link pollInterval}). */
  pollInterval_: number = 30 * 1000;
  /** Export compliance (set by {@link usesNonExemptEncryption}). */
  usesNonExemptEncryption_?: boolean;
  /** "What to Test" notes by locale (set by {@link whatToTest}). */
  whatToTest_: Map<string, string> = new Map();
  /** Beta groups to add the build to (set by {@link group}). */
  groups_: string[] = [];
  /** Whether to submit for beta review (set by {@link submitForBetaReview}). */
  submitForBetaReview_ = false;

  /** The app's bundle id, e.g. `com.example.app`; required. */
  bundleId(id: string): this {
    this.bundleId_ = id;
    return this;
  }

  /** The uploaded build's number, `CFBundleVersion`; required. */
  buildNumber(number: string | number): this {
    this.buildNumber_ = String(number);
    return this;
  }

  /**
   * The uploaded build's version, `CFBundleShortVersionString` — needed when
   * the same build number exists under several versions.
   */
  version(version: string): this {
    this.version_ = version;
    return this;
  }

  /** The build's platform — needed when the app ships on several. */
  platform(platform: TestFlightPlatform): this {
    this.platform_ = platform;
    return this;
  }

  /** The longest wait for the build to finish processing (`"45m"`, or ms); default 30 minutes. */
  timeout(duration: string | number): this {
    this.timeout_ = wholeMs("timeout", parseDuration(duration), 1);
    return this;
  }

  /** The time between two looks at the build (`"1m"`, or ms); default 30 seconds. */
  pollInterval(duration: string | number): this {
    this.pollInterval_ = wholeMs("pollInterval", parseDuration(duration), 1000);
    return this;
  }

  /**
   * Answer the export-compliance question: whether the app uses encryption
   * beyond the exempt kinds. Until it is answered — here, or by
   * `ITSAppUsesNonExemptEncryption` in `Info.plist` — the build sits at
   * *Missing Compliance* and no tester can install it.
   */
  usesNonExemptEncryption(uses: boolean): this {
    this.usesNonExemptEncryption_ = uses;
    return this;
  }

  /** The "What to Test" notes testers see, per locale; default locale `en-US`. */
  whatToTest(text: string, locale = "en-US"): this {
    this.whatToTest_.set(locale, text);
    return this;
  }

  /** Add the build to this beta group, by name; repeatable. */
  group(name: string): this {
    this.groups_.push(name);
    return this;
  }

  /** Submit the build for beta review, which external testing needs. */
  submitForBetaReview(): this {
    this.submitForBetaReview_ = true;
    return this;
  }
}
