// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The error `@zuke/az` raises of its own. A command that fails surfaces core's
 * ordinary `CommandError` (or `CommandTimeoutError`); this covers what happens
 * after a command succeeded — output the package cannot read.
 *
 * @module
 */

/**
 * The Azure CLI succeeded but printed something a reader cannot use: output
 * that is not JSON, JSON of an unexpected shape, an empty or multi-line answer
 * where one value was expected, no data where a number was expected, or a
 * capture that was truncated.
 *
 * The message never quotes the output itself. Several readers return access
 * tokens and secret values, and an error that echoed what the CLI printed
 * would put the secret in the build log it was read to stay out of.
 */
export class AzOutputError extends Error {
  /** The error name. */
  override name = "AzOutputError";

  /** Build the error from the reader that failed and what was wrong. */
  constructor(
    /** The reader that could not use the output, e.g. `AzTasks.metricValue`. */
    readonly task: string,
    /** What was wrong with the output, without quoting it. */
    readonly detail: string,
  ) {
    super(`${task}: ${detail}`);
  }
}
