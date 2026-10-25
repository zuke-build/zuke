// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The error `@zuke/google` raises: a service-account key that cannot sign in,
 * a Google Play Developer API request the API refused, a response missing what
 * the task reads from it, or an upload that ran out of time.
 *
 * @module
 */

/**
 * Raised by `GooglePlayTasks.upload`. The message names the step and, for a
 * refused request, Google's own error message; it never carries the
 * service-account key or an access token.
 */
export class GooglePlayError extends Error {
  /** The error name. */
  override name = "GooglePlayError";

  /** Build the error from its message and, for a refused request, the HTTP status. */
  constructor(
    message: string,
    /** The HTTP status of the refused request, or `undefined` when no request was refused. */
    readonly status?: number,
  ) {
    super(message);
  }
}
