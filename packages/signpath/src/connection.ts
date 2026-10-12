// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link SignPathConnectionSettings} — which SignPath organization a call goes
 * to and how it authenticates: the organization id, the API token, the API's
 * base URL, the per-request limits and retries, and the seams (`fetch`,
 * `readEnv`, `sleep`, `now`, `log`) a test replaces.
 *
 * Every `SignPathTasks` method's settings extend it, so each takes one lambda
 * that sets both the connection and the call's own options. A build that talks
 * to one organization repeatedly shares the connection half as a function:
 *
 * ```ts
 * const signpath = <S extends SignPathConnectionSettings>(s: S) =>
 *   s.organizationId(orgId).apiToken(token);
 * await SignPathTasks.status((s) => signpath(s).signingRequestId(id));
 * ```
 *
 * @module
 */

import { defaultReadEnv, parseDuration } from "@zuke/core";
import { wholeAtLeast } from "./limits.ts";

/** The SignPath REST API's base URL when no {@link SignPathConnectionSettings.apiUrl} is set. */
export const SIGNPATH_API_URL = "https://app.signpath.io/Api";

/** The environment variable the organization id is read from by default. */
export const SIGNPATH_ORGANIZATION_ID_ENV = "SIGNPATH_ORGANIZATION_ID";

/** The environment variable the API token is read from by default. */
export const SIGNPATH_API_TOKEN_ENV = "SIGNPATH_API_TOKEN";

/** How long one API call may take when no {@link SignPathConnectionSettings.requestTimeout} is set. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * How long a signed-artifact download may take when no
 * {@link SignPathConnectionSettings.downloadTimeout} is set — the five minutes
 * SignPath's own GitHub action allows.
 */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000;

/** The largest signed artifact downloaded when no {@link SignPathConnectionSettings.maxDownloadBytes} is set: 2 GiB. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** How many times a transient failure is retried when no {@link SignPathConnectionSettings.retries} is set. */
const DEFAULT_RETRIES = 3;

/** The connection half of every SignPath call's settings. */
export class SignPathConnectionSettings {
  /** The organization id (set by {@link organizationId}); else read from the environment. */
  organizationId_?: string;
  /** The API token (set by {@link apiToken}); else read from the environment. */
  apiToken_?: string;
  /** The REST API's base URL (set by {@link apiUrl}). */
  apiUrl_: string = SIGNPATH_API_URL;
  /** The per-call timeout in ms (set by {@link requestTimeout}). */
  requestTimeout_: number = DEFAULT_REQUEST_TIMEOUT_MS;
  /** The signed-artifact download timeout in ms (set by {@link downloadTimeout}). */
  downloadTimeout_: number = DEFAULT_DOWNLOAD_TIMEOUT_MS;
  /** The signed-artifact size cap in bytes (set by {@link maxDownloadBytes}). */
  maxDownloadBytes_: number = DEFAULT_MAX_DOWNLOAD_BYTES;
  /** How many times a transient failure is retried (set by {@link retries}). */
  retries_: number = DEFAULT_RETRIES;
  /** The `fetch` to use (set by {@link fetch}); the global one by default. */
  fetch_: typeof fetch = fetch;
  /** The environment reader (set by {@link readEnv}). */
  readEnv_: (name: string) => string | undefined = defaultReadEnv;
  /** How the task waits between polls and retries (set by {@link sleep}). */
  sleep_: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  /** The clock, in epoch ms (set by {@link now}). */
  now_: () => number = Date.now;
  /** Where progress lines go (set by {@link log}); `console.log` by default. */
  log_: (line: string) => void = (line) => console.log(line);

  /**
   * The SignPath organization id — the GUID in the web app's URLs and under
   * *Organization settings*. Defaults to the `SIGNPATH_ORGANIZATION_ID`
   * environment variable.
   */
  organizationId(id: string): this {
    this.organizationId_ = id;
    return this;
  }

  /**
   * The API token of a SignPath user with submitter permission on the
   * project's signing policy, sent as `Authorization: Bearer <token>`.
   * Defaults to the `SIGNPATH_API_TOKEN` environment variable.
   *
   * The token never reaches a progress line or an error message: every
   * message this package builds is scrubbed of it. Declare it in the build as
   * a `parameter(...).secret()` so Zuke masks it in its own output too.
   */
  apiToken(token: string): this {
    this.apiToken_ = token;
    return this;
  }

  /**
   * The REST API's base URL, `https://app.signpath.io/Api` by default; the
   * version and organization (`/v1/<org>/…`) are appended. It carries the
   * token, so it must be `https:` unless it is loopback or
   * `ZUKE_ALLOW_INSECURE_URL` is set. The web app's links in errors and
   * progress lines use the same origin (`<origin>/Web/<org>/…`).
   */
  apiUrl(url: string): this {
    this.apiUrl_ = url;
    return this;
  }

  /** Abort one API call after this long (`"30s"`, or ms); default one minute. */
  requestTimeout(duration: string | number): this {
    this.requestTimeout_ = wholeAtLeast(
      parseDuration(duration),
      1,
      "requestTimeout",
    );
    return this;
  }

  /**
   * Abort a signed-artifact download that has not finished after this long
   * (`"10m"`, or ms); default five minutes.
   */
  downloadTimeout(duration: string | number): this {
    this.downloadTimeout_ = wholeAtLeast(
      parseDuration(duration),
      1,
      "downloadTimeout",
    );
    return this;
  }

  /** Refuse a signed artifact larger than this many bytes; default 2 GiB. */
  maxDownloadBytes(bytes: number): this {
    this.maxDownloadBytes_ = wholeAtLeast(bytes, 1, "maxDownloadBytes");
    return this;
  }

  /**
   * Retry a transient failure this many times (default 3), with a doubling
   * delay from one second. A status poll or a download is retried after a
   * network error, a timeout, or HTTP 429, 502, 503 or 504; a submission only
   * after 429 or 503, the answers that say the request was not processed, so
   * a retry cannot create a second signing request.
   */
  retries(count: number): this {
    this.retries_ = wholeAtLeast(count, 0, "retries");
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
