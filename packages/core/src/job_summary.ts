// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Appending to the GitHub Actions job summary — the panel Actions renders above
 * a job's logs, from whatever Markdown a step writes to `GITHUB_STEP_SUMMARY`.
 *
 * It is the natural home for a report a build wants a human to read after the
 * fact (a coverage table, a scanner's findings), and it removes the reason most
 * pipelines reach for an artifact upload: the summary is already there, needs no
 * step, and survives as long as the run does.
 *
 * Appending — never overwriting — is deliberate: several parts of one run write
 * their own sections to the same file, and a truncating write would silently
 * drop the others. Actions provisions a fresh summary file per step, so a run's
 * appends do not accumulate across steps.
 *
 * @module
 */

import { ambientRedactor } from "./ambient_redactor.ts";

/**
 * Append `markdown` to the Actions job summary, returning whether it was
 * written. Outside Actions (no `GITHUB_STEP_SUMMARY`) it is a no-op returning
 * `false`, so the same code path works locally.
 *
 * Best-effort by design: an unwritable summary file reports `false` rather than
 * throwing. A report that could not be *displayed* must never fail the build
 * that produced it — the build's own result is the signal that matters.
 */
export function appendJobSummary(markdown: string): boolean {
  // Redacted here, at the one exported function that writes this file, so a
  // caller cannot publish a secret by forgetting to. The job summary is visible
  // to everyone who can view the run, and the `::add-mask::` directives do not
  // cover it: those mask the runner's log stream, not a file the build writes.
  //
  // The ambient redactor is the only seam available to a caller outside this
  // package: a validation, a remediation and a lifecycle hook all have no
  // redactor on their context. It is installed in two places — around the plan
  // by the executor, and around every hook by the lifecycle, since `onStart`
  // and `onFinish` run outside the plan and are exactly where a build adds its
  // own summary section.
  //
  // What this does not cover is a caller with no run in scope at all: a
  // detached callback that outlives the run, or a script calling this directly.
  // There is no redactor to find there, and the text is written as given.
  const redactor = ambientRedactor();
  if (redactor !== undefined) markdown = redactor.redact(markdown);
  let path: string | undefined;
  try {
    path = Deno.env.get("GITHUB_STEP_SUMMARY");
  } catch {
    return false; // no env access — nothing to write to
  }
  if (path === undefined || path === "") return false;
  try {
    Deno.writeTextFileSync(
      path,
      markdown.endsWith("\n") ? markdown : `${markdown}\n`,
      {
        append: true,
      },
    );
    return true;
  } catch {
    return false;
  }
}
