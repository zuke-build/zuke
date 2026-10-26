// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `GooglePlayTasks.upload`: the service account, the app and
 * bundle, the release, and the seams (`fetch`, the clock, logging) the task is
 * tested through.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { PathLike } from "@zuke/core/tooling";

/** The Google Play Developer API's base URL. */
export const GOOGLE_PLAY_API_URL = "https://androidpublisher.googleapis.com";

/**
 * A release's status on its track. `completed` makes it live for the track's
 * testers or users; `draft` saves it to publish from the Play Console — the
 * only status Google accepts for an app that has never had a release.
 */
export type GooglePlayReleaseStatus = "completed" | "draft";

/**
 * Settings for `GooglePlayTasks.upload`.
 *
 * The service-account key and every token signed with it stay out of progress
 * lines and errors. Declare the key in the build as `parameter(...).secret()`
 * so Zuke masks it in its own output too.
 */
export class GooglePlaySettings {
  /** The service-account key's JSON text (set by {@link serviceAccount}). */
  serviceAccount_?: string;
  /** The app's package name (set by {@link packageName}). */
  packageName_?: string;
  /** The app bundle's path (set by {@link bundle}). */
  bundle_?: string;
  /** The track (set by {@link track}). */
  track_ = "internal";
  /** The release status (set by {@link status}). */
  status_: GooglePlayReleaseStatus = "completed";
  /** Release notes by language (set by {@link releaseNotes}). */
  releaseNotes_: Map<string, string> = new Map();
  /** Whether the commit skips review (set by {@link changesNotSentForReview}). */
  changesNotSentForReview_ = false;
  /** The longest the whole upload may take, in ms (set by {@link timeout}). */
  timeout_: number = 15 * 60 * 1000;
  /** The API's base URL (set by {@link apiUrl}). */
  apiUrl_: string = GOOGLE_PLAY_API_URL;
  /** The `fetch` to use (set by {@link fetch}). */
  fetch_: typeof fetch = fetch;
  /** The environment reader (set by {@link readEnv}). */
  readEnv_: (name: string) => string | undefined = (name) => Deno.env.get(name);
  /** The clock, in epoch ms (set by {@link now}). */
  now_: () => number = Date.now;
  /** Where progress lines go (set by {@link log}). */
  log_: (line: string) => void = (line) => console.log(line);

  /**
   * The service account's key, as the text of the JSON file the Play Console
   * (or Google Cloud) downloaded; required. The account needs the *Release
   * apps to testing tracks* (or *Release to production*) permission on the
   * app.
   */
  serviceAccount(json: string): this {
    this.serviceAccount_ = json;
    return this;
  }

  /** The app's package name, e.g. `com.example.app`; required. */
  packageName(name: string): this {
    this.packageName_ = name;
    return this;
  }

  /** The Android app bundle (`.aab`) to upload; required. */
  bundle(path: PathLike): this {
    this.bundle_ = String(path);
    return this;
  }

  /**
   * The track to release on: `internal` (the default), `alpha`, `beta`,
   * `production`, or the name of a closed testing track.
   */
  track(name: string): this {
    this.track_ = name;
    return this;
  }

  /** The release's status; default `completed`. */
  status(status: GooglePlayReleaseStatus): this {
    this.status_ = status;
    return this;
  }

  /**
   * The release notes users see, per BCP-47 language (`"en-US"`, `"bg"`);
   * repeatable, one call per language. Default language `en-US`.
   */
  releaseNotes(text: string, language = "en-US"): this {
    this.releaseNotes_.set(language, text);
    return this;
  }

  /**
   * Commit without sending the changes for review, so an app with managed
   * publishing or a release that review would otherwise hold can go out as
   * Google allows it to.
   */
  changesNotSentForReview(): this {
    this.changesNotSentForReview_ = true;
    return this;
  }

  /** The longest the whole upload may take (`"30m"`, or ms); default 15 minutes. */
  timeout(duration: string | number): this {
    const ms = parseDuration(duration);
    if (!Number.isSafeInteger(ms) || ms < 1) {
      throw new Error(
        `GooglePlayTasks.upload: .timeout() must be at least 1 ms, not ${ms}.`,
      );
    }
    this.timeout_ = ms;
    return this;
  }

  /**
   * The API's base URL, `https://androidpublisher.googleapis.com` by default.
   * It carries the access token, so it must be `https:` unless it is loopback
   * or `ZUKE_ALLOW_INSECURE_URL` is set.
   */
  apiUrl(url: string): this {
    this.apiUrl_ = url;
    return this;
  }

  /** Send with this `fetch` instead of the global one — the seam tests use. */
  fetch(fetcher: typeof fetch): this {
    this.fetch_ = fetcher;
    return this;
  }

  /** Read environment variables through `reader` instead of `Deno.env`. */
  readEnv(reader: (name: string) => string | undefined): this {
    this.readEnv_ = reader;
    return this;
  }

  /** Read the time from `clock` (epoch ms) instead of `Date.now`. */
  now(clock: () => number): this {
    this.now_ = clock;
    return this;
  }

  /** Send progress lines to `sink` instead of `console.log`. */
  log(sink: (line: string) => void): this {
    this.log_ = sink;
    return this;
  }
}
