// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The errors `@zuke/aws` raises of its own. A command that fails surfaces
 * core's ordinary `CommandError` (or `CommandTimeoutError`); these cover what
 * happens after a command succeeded — output the package cannot read, and a
 * Logs Insights query that ended without results.
 *
 * @module
 */

/**
 * The AWS CLI succeeded but printed something a reader cannot use: output
 * that is not JSON, JSON of an unexpected shape, an empty or multi-line answer
 * where one value was expected, or a capture that was truncated.
 *
 * The message never quotes the output itself. Several readers return
 * credentials and secret payloads, and an error that echoed what the CLI
 * printed would put the secret in the build log it was read to stay out of.
 */
export class AwsOutputError extends Error {
  /** The error name. */
  override name = "AwsOutputError";

  /** Build the error from the reader that failed and what was wrong. */
  constructor(
    /** The reader that could not use the output, e.g. `AwsTasks.metricValue`. */
    readonly task: string,
    /** What was wrong with the output, without quoting it. */
    readonly detail: string,
  ) {
    super(`${task}: ${detail}`);
  }
}

/**
 * A CloudWatch Logs Insights query did not complete: the service reported it
 * `Failed`, `Cancelled` or `Timeout`, or it was still running when the
 * reader's own timeout ran out.
 */
export class AwsLogsQueryError extends Error {
  /** The error name. */
  override name = "AwsLogsQueryError";

  /** Build the error from the query, its last status and an explanation. */
  constructor(
    /** The id `logs start-query` returned. */
    readonly queryId: string,
    /** The last status `logs get-query-results` reported. */
    readonly status: string,
    message: string,
  ) {
    super(message);
  }
}
