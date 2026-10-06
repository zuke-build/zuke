// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link PrometheusConnectionSettings} — where a call goes and how it
 * authenticates: the base URL, the credential sources, the client-side
 * timeout and response cap, and the seams (`fetch`, `readEnv`,
 * `readTextFile`, `now`) a test or a credential source replaces.
 *
 * Every endpoint's settings extend it, so each `PrometheusTasks` method takes
 * one lambda that sets both the connection and the call's own parameters. A
 * build that queries one server repeatedly shares the connection half as a
 * function:
 *
 * ```ts
 * const prod = <S extends PrometheusConnectionSettings>(s: S) =>
 *   s.url("https://prometheus.internal").bearerToken(token);
 * await PrometheusTasks.query((s) => prod(s).query("up"));
 * ```
 *
 * @module
 */

import { defaultReadEnv, parseDuration } from "@zuke/core";
import {
  basicCredentials,
  bearerCredentials,
  headerCredentials,
  type PrometheusCredentials,
} from "./credentials.ts";

/** How long a call may take when no {@link PrometheusConnectionSettings.requestTimeout} is set. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The largest response body read when no {@link PrometheusConnectionSettings.maxResponseBytes} is set: 64 MiB. */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/** The connection half of every Prometheus call's settings. */
export class PrometheusConnectionSettings {
  /** The Prometheus base URL (set by {@link url}). */
  url_?: string;
  /** The credential sources, in the order they run (set by the auth setters). */
  readonly credentials_: PrometheusCredentials[] = [];
  /** The client-side timeout in ms (set by {@link requestTimeout}). */
  requestTimeout_: number = DEFAULT_REQUEST_TIMEOUT_MS;
  /** The response size cap in bytes (set by {@link maxResponseBytes}). */
  maxResponseBytes_: number = DEFAULT_MAX_RESPONSE_BYTES;
  /** A caller's signal that cancels the call (set by {@link signal}). */
  signal_?: AbortSignal;
  /** The `fetch` to use (set by {@link fetch}); the global one by default. */
  fetch_: typeof fetch = fetch;
  /** The environment reader (set by {@link readEnv}). */
  readEnv_: (name: string) => string | undefined = defaultReadEnv;
  /** The text-file reader credential sources use (set by {@link readTextFile}). */
  readTextFile_: (path: string) => Promise<string> = (path) =>
    Deno.readTextFile(path);
  /** The clock, in epoch ms (set by {@link now}). */
  now_: () => number = Date.now;

  /**
   * The Prometheus base URL, such as `https://prometheus.internal`. A path or
   * query string it carries — a proxy prefix, a tenant parameter — is kept,
   * and the endpoint path is appended. It must be `https:` unless it is
   * loopback, or `ZUKE_ALLOW_INSECURE_URL` is set: the answers decide whether
   * a release proceeds, and a plaintext request lets anyone on the path both
   * read the credential and choose the answer. Userinfo in the URL
   * (`https://user:pass@host`) is taken off the URL and sent as basic auth.
   */
  url(url: string): this {
    this.url_ = url;
    return this;
  }

  /** Authenticate with `Authorization: Bearer <token>`. */
  bearerToken(token: string): this {
    this.credentials_.push(bearerCredentials(token));
    return this;
  }

  /** Authenticate with HTTP basic auth (`Authorization: Basic …`). */
  basicAuth(username: string, password: string): this {
    this.credentials_.push(basicCredentials(username, password));
    return this;
  }

  /**
   * Send a fixed header, such as a tenant id (`X-Scope-OrgID`) or an API key.
   * Its value is masked in errors like any credential (when eight or more
   * characters long).
   */
  header(name: string, value: string): this {
    this.credentials_.push(headerCredentials(name, value));
    return this;
  }

  /**
   * Add a credential source: a function handed the outgoing request — method,
   * full URL, headers so far, body bytes — and the connection's seams, that
   * returns the headers to add. Sources run in the order configured, so put a
   * request signer last.
   *
   * ```ts
   * s.credentials(async (_request, { readTextFile }) => ({
   *   authorization: `Bearer ${(await readTextFile("/run/secrets/prom")).trim()}`,
   * }))
   * ```
   */
  credentials(source: PrometheusCredentials): this {
    this.credentials_.push(source);
    return this;
  }

  /**
   * How long the call may take, end to end (`"10s"`, or ms; default 30 s).
   * Client-side: the query's own `timeout` parameter is separate.
   */
  requestTimeout(duration: string | number): this {
    this.requestTimeout_ = parseDuration(duration);
    return this;
  }

  /**
   * The largest response body to read, in bytes (default 64 MiB). A larger
   * one fails the call rather than being buffered whole.
   */
  maxResponseBytes(bytes: number): this {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new Error(
        `maxResponseBytes(${bytes}) must be a positive whole number of bytes.`,
      );
    }
    this.maxResponseBytes_ = bytes;
    return this;
  }

  /** A signal that cancels the call — a run's or a bake's own. */
  signal(signal: AbortSignal): this {
    this.signal_ = signal;
    return this;
  }

  /** The `fetch` to use — the seam a test answers calls through. */
  fetch(fetcher: typeof fetch): this {
    this.fetch_ = fetcher;
    return this;
  }

  /**
   * The environment reader: consulted for `ZUKE_ALLOW_INSECURE_URL` and handed
   * to credential sources.
   */
  readEnv(reader: (name: string) => string | undefined): this {
    this.readEnv_ = reader;
    return this;
  }

  /** The text-file reader handed to credential sources. */
  readTextFile(reader: (path: string) => Promise<string>): this {
    this.readTextFile_ = reader;
    return this;
  }

  /** The clock handed to credential sources, in epoch milliseconds. */
  now(clock: () => number): this {
    this.now_ = clock;
    return this;
  }
}
