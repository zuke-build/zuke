// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The error `@zuke/gcloud`'s readers raise of their own. A command that fails
 * surfaces core's ordinary `CommandError`, and an API call that fails an
 * `HttpError`; this covers what happens after either succeeded — output a
 * reader cannot use.
 *
 * @module
 */

/**
 * gcloud or a Google API succeeded but returned something a reader cannot
 * use: output that is not JSON, JSON of an unexpected shape, or a capture
 * that was truncated.
 *
 * The message never quotes the output itself. A log read can return any
 * payload an application logged, and an error that echoed it would put a
 * secret in the build log.
 */
export class GcloudOutputError extends Error {
  /** The error name. */
  override name = "GcloudOutputError";

  /** Build the error from the reader that failed and what was wrong. */
  constructor(
    /** The reader that could not use the output, e.g. `GcloudTasks.logEntryCount`. */
    readonly task: string,
    /** What was wrong with the output, without quoting it. */
    readonly detail: string,
  ) {
    super(`${task}: ${detail}`);
  }
}
