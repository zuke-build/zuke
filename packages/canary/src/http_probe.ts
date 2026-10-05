// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `httpProbe(...)`: request a URL a number of times and fail the canary when
 * too many requests fail.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { bakeFor } from "./bake.ts";
import { requestSignal } from "./request.ts";
import type { CanaryAnalysis } from "./types.ts";

/** How many requests a probe makes when no count is set. */
const DEFAULT_SAMPLES = 10;

/** How long one request may take when no timeout is set. */
const DEFAULT_TIMEOUT = 5_000;

/** The pause between requests when none is set. */
const DEFAULT_INTERVAL = 1_000;

/** Settings for {@link httpProbe}: what to request, how often, how strictly. */
export class HttpProbeSettings {
  /** The URL to request (set by {@link url}). */
  url_?: string;
  /** How many requests to make (set by {@link samples}). */
  samples_: number = DEFAULT_SAMPLES;
  /** How many failed requests are tolerated (set by {@link maxFailures}). */
  maxFailures_ = 0;
  /** The statuses that count as healthy; any 2xx when empty (set by {@link expectStatus}). */
  readonly expectStatus_: number[] = [];
  /** How long one request may take, in ms (set by {@link timeout}). */
  timeout_: number = DEFAULT_TIMEOUT;
  /** The pause between requests, in ms (set by {@link interval}). */
  interval_: number = DEFAULT_INTERVAL;
  /** Request headers (set by {@link header}). */
  readonly headers_: Record<string, string> = {};
  /** The `fetch` to use (set by {@link fetch}); the global one by default. */
  fetch_: typeof fetch = fetch;

  /** The URL to request. */
  url(url: string): this {
    this.url_ = url;
    return this;
  }

  /** How many requests to make (default 10). */
  samples(count: number): this {
    this.samples_ = count;
    return this;
  }

  /** How many failed requests are tolerated before the probe fails (default 0). */
  maxFailures(count: number): this {
    this.maxFailures_ = count;
    return this;
  }

  /** The statuses that count as healthy; any 2xx when none are set. */
  expectStatus(...statuses: number[]): this {
    this.expectStatus_.push(...statuses);
    return this;
  }

  /** How long one request may take (`"5s"`, or ms; default 5 s). */
  timeout(duration: string | number): this {
    this.timeout_ = parseDuration(duration);
    return this;
  }

  /** The pause between requests (`"1s"`, or ms; default 1 s). */
  interval(duration: string | number): this {
    this.interval_ = parseDuration(duration);
    return this;
  }

  /** Add a request header. */
  header(name: string, value: string): this {
    this.headers_[name] = value;
    return this;
  }

  /** The `fetch` to use — the seam a test answers requests through. */
  fetch(fetcher: typeof fetch): this {
    this.fetch_ = fetcher;
    return this;
  }
}

/**
 * An analysis that requests a URL a number of times and fails the canary when
 * more than `maxFailures` of them fail — a status outside the expected ones, a
 * timeout, or a connection error:
 *
 * ```ts
 * httpProbe((h) => h.url("https://api.example.com/healthz").samples(30))
 * ```
 *
 * The lambda runs on each check, so it may read resolved parameters. The
 * failure message passes through the run's redactor.
 */
export function httpProbe(
  configure: Configure<HttpProbeSettings>,
): CanaryAnalysis {
  return {
    name: "httpProbe",
    async validate(context) {
      const settings = configure(new HttpProbeSettings());
      const url = settings.url_;
      if (url === undefined) {
        throw new Error("httpProbe has no URL — call h.url(...).");
      }
      if (!Number.isInteger(settings.samples_) || settings.samples_ < 1) {
        throw new Error(
          `httpProbe needs at least one sample, got ${settings.samples_}.`,
        );
      }
      const healthy = (status: number): boolean =>
        settings.expectStatus_.length === 0
          ? status >= 200 && status < 300
          : settings.expectStatus_.includes(status);
      const pause = context.signal ?? new AbortController().signal;
      const failures = new Map<string, number>();
      for (let i = 0; i < settings.samples_; i++) {
        if (i > 0) await bakeFor(settings.interval_, pause);
        const failure = await probeOnce(url, settings, healthy, context.signal);
        if (failure !== undefined) {
          failures.set(failure, (failures.get(failure) ?? 0) + 1);
        }
      }
      const failed = [...failures.values()].reduce((a, b) => a + b, 0);
      if (failed > settings.maxFailures_) {
        const reasons = [...failures].map(([reason, count]) =>
          count === 1 ? reason : `${reason} ×${count}`
        ).join(", ");
        throw new Error(
          context.redact(
            `httpProbe: ${failed} of ${settings.samples_} requests to ${url} ` +
              `failed (at most ${settings.maxFailures_} allowed): ${reasons}`,
          ),
        );
      }
    },
  };
}

/** One request: `undefined` when healthy, else why it was not. */
async function probeOnce(
  url: string,
  settings: HttpProbeSettings,
  healthy: (status: number) => boolean,
  outer: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const response = await settings.fetch_(url, {
      headers: settings.headers_,
      signal: requestSignal(settings.timeout_, outer),
    });
    await response.body?.cancel();
    return healthy(response.status) ? undefined : `HTTP ${response.status}`;
  } catch (error) {
    // The run's own cancellation is not the candidate's failure.
    outer?.throwIfAborted();
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return "timeout";
    }
    return error instanceof Error ? error.message : String(error);
  }
}
