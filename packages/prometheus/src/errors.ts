// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The two ways a Prometheus call fails: the server (or something in front of
 * it) answered with a refusal — {@link PrometheusApiError} — or no usable
 * answer arrived at all — {@link PrometheusRequestError}.
 *
 * Two types because callers act on the difference. A refusal carries the
 * status and Prometheus's `errorType`, and a gate may well recover from a
 * `bad_data` it expected; a timeout or a proxy's HTML page is neither, and must
 * not be mistaken for one.
 *
 * Neither ever carries a credential. The transport scrubs every message it
 * builds — the secrets the configured credentials added, then any URL's
 * userinfo and credential-bearing parameters — before constructing one, and
 * neither keeps the underlying error as a `cause`, because a runtime's own
 * message (a failed `fetch` naming the URL it was handed) is exactly where a
 * secret would ride along unscrubbed.
 *
 * @module
 */

/**
 * Prometheus, or an HTTP layer in front of it, refused the call: a non-2xx
 * status, or an envelope whose `status` is `"error"`.
 *
 * ```ts
 * try {
 *   await PrometheusTasks.query((s) => s.url(url).query("rate(x[5m]"));
 * } catch (error) {
 *   if (error instanceof PrometheusApiError && error.errorType === "bad_data") {
 *     // the expression did not parse
 *   }
 * }
 * ```
 */
export class PrometheusApiError extends Error {
  /** The error name. */
  override name = "PrometheusApiError";
  /** The HTTP method of the failing call. */
  readonly method: string;
  /** The endpoint path, such as `/api/v1/query` (never the base URL). */
  readonly path: string;
  /** The HTTP status of the answer. */
  readonly status: number;
  /** Prometheus's `errorType` (`bad_data`, `execution`, `timeout`, …), when sent. */
  readonly errorType: string | undefined;
  /**
   * What went wrong: the envelope's `error` text, or — for an answer that was
   * not a Prometheus envelope, such as a gateway's error page — the start of
   * the body. Scrubbed of credentials and capped in length.
   */
  readonly detail: string | undefined;

  /** Build the error from the failing call and what the server said. */
  constructor(
    method: string,
    path: string,
    status: number,
    errorType: string | undefined,
    detail: string | undefined,
  ) {
    super(
      `${method} ${path} failed: HTTP ${status}` +
        (errorType === undefined ? "" : ` (${errorType})`) +
        (detail === undefined ? "" : `: ${detail}`),
    );
    this.method = method;
    this.path = path;
    this.status = status;
    this.errorType = errorType;
    this.detail = detail;
  }
}

/**
 * A Prometheus call produced no usable answer: the request could not be sent
 * or timed out, a credential source failed, or the answer was too large, not
 * JSON, or not shaped as the API reference describes.
 */
export class PrometheusRequestError extends Error {
  /** The error name. */
  override name = "PrometheusRequestError";
  /** The HTTP method of the failing call. */
  readonly method: string;
  /** The endpoint path, such as `/api/v1/query` (never the base URL). */
  readonly path: string;
  /** The HTTP status, when an answer arrived; `undefined` when none did. */
  readonly status: number | undefined;

  /** Build the error from the failing call and the (scrubbed) reason. */
  constructor(
    method: string,
    path: string,
    status: number | undefined,
    reason: string,
  ) {
    super(`${method} ${path} failed: ${reason}`);
    this.method = method;
    this.path = path;
    this.status = status;
  }
}
