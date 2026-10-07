// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Running a command for a reader. Internal to the package: every reader —
 * the `AwsTasks` ones, the Logs Insights query, the canary analysis — runs
 * its commands through here, so they agree on three things.
 *
 * - It runs quietly: what a reader reads is not streamed to the build log.
 * - A failed exit is a `CommandError`, even after `.noThrow()`: a reader
 *   promises a value, and reading a failed command's empty stdout would only
 *   turn the CLI's real error into a misleading "not JSON".
 * - Its `--output` and `--query` are pinned after the caller's lambda, so the
 *   CLI prints what the reader parses.
 *
 * @module
 */

import { readJson, readScalar } from "./scalar_output.ts";
import { type AwsSettings, failOnExit } from "./settings.ts";

/**
 * The `--query` that keeps the CLI's whole answer — JMESPath's current node.
 * Pinned where a reader parses the full document, so a query set through a
 * shared `.aws(...)` lambda cannot reshape it.
 */
export const WHOLE_ANSWER = "@";

/** Run `settings` quietly and insist that it succeeded. */
async function succeeded(settings: AwsSettings) {
  const output = await settings.quiet().run();
  failOnExit(settings, output);
  return output;
}

/** The one line `settings` print with `--output text` and `--query query`. */
export async function scalarFrom(
  settings: AwsSettings,
  task: string,
  subject: string,
): Promise<string> {
  return readScalar(await succeeded(settings), task, subject);
}

/** The JSON document `settings` print with `--output json` and `--query query`. */
export async function jsonFrom(
  settings: AwsSettings,
  task: string,
  query: string,
): Promise<unknown> {
  return readJson(
    await succeeded(settings.output("json").query(query)),
    task,
  );
}
