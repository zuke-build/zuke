// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The App Store Connect API connection: the API key a request is signed with,
 * and the seams (`fetch`, the clock, sleeping, logging) the tasks built on it
 * are tested through.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";

/** The App Store Connect API's base URL. */
export const APP_STORE_CONNECT_API_URL =
  "https://api.appstoreconnect.apple.com";

/**
 * Settings for a task that calls the App Store Connect API with an API key
 * (*Users and Access → Integrations* in App Store Connect): the issuer id, the
 * key id, and the `AuthKey_<keyId>.p8` private key.
 *
 * The private key and every token signed with it stay out of progress lines
 * and errors. Declare them in the build as `parameter(...).secret()` so Zuke
 * masks them in its own output too.
 */
export class AppStoreConnectSettings {
  /** The API key's issuer id (set by {@link issuerId}). */
  issuerId_?: string;
  /** The API key's id (set by {@link keyId}). */
  keyId_?: string;
  /** The private key, PEM (set by {@link privateKey}). */
  privateKey_?: string;
  /** The private key's file (set by {@link privateKeyFile}). */
  privateKeyFile_?: string;
  /** The API's base URL (set by {@link apiUrl}). */
  apiUrl_: string = APP_STORE_CONNECT_API_URL;
  /** The `fetch` to use (set by {@link fetch}). */
  fetch_: typeof fetch = fetch;
  /** The environment reader (set by {@link readEnv}). */
  readEnv_: (name: string) => string | undefined = (name) => Deno.env.get(name);
  /** How the task waits between polls (set by {@link sleep}). */
  sleep_: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  /** The clock, in epoch ms (set by {@link now}). */
  now_: () => number = Date.now;
  /** Where progress lines go (set by {@link log}). */
  log_: (line: string) => void = (line) => console.log(line);

  /** The API key's issuer id, a UUID. */
  issuerId(id: string): this {
    this.issuerId_ = id;
    return this;
  }

  /** The API key's id, e.g. `ABC123`. */
  keyId(id: string): this {
    this.keyId_ = id;
    return this;
  }

  /** The private key, as the PEM text of `AuthKey_<keyId>.p8`. */
  privateKey(pem: string): this {
    this.privateKey_ = pem;
    return this;
  }

  /** Read the private key from `AuthKey_<keyId>.p8`. */
  privateKeyFile(path: PathLike): this {
    this.privateKeyFile_ = String(path);
    return this;
  }

  /**
   * The API's base URL, `https://api.appstoreconnect.apple.com` by default.
   * It carries the token, so it must be `https:` unless it is loopback or
   * `ZUKE_ALLOW_INSECURE_URL` is set.
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

  /** Wait through `sleeper` instead of a timer — the seam tests use. */
  sleep(sleeper: (ms: number) => Promise<void>): this {
    this.sleep_ = sleeper;
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
