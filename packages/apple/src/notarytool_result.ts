// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `notarytool` reports, typed: a submission (from `submit`, `info` and
 * each `history` entry) and a notarization log (from `log`), plus the parsers
 * that read them from the tool's JSON output.
 *
 * The parsers treat the output as untrusted. A field of the wrong type is read
 * as absent rather than trusted, the one field a result cannot do without — a
 * submission's `id` — must be a non-empty string, and anything that is not a
 * JSON object is refused with a {@link NotarytoolOutputError} that keeps the
 * raw text off the message.
 *
 * @module
 */

import { NotarytoolOutputError } from "./errors.ts";

/** A notarization submission as `notarytool` reports it. */
export interface NotarytoolSubmission {
  /** The submission id, used by `info`, `log` and `wait`. */
  id: string;
  /**
   * The status — `Accepted`, `Invalid`, `Rejected` or `In Progress`. Absent
   * from a `submit` run without `--wait`, which only reports the upload.
   */
  status?: string;
  /** notarytool's message, e.g. `Processing complete`. */
  message?: string;
  /** The uploaded file's name (`info`, `history`). */
  name?: string;
  /** When the submission was created, ISO 8601 (`info`, `history`). */
  createdDate?: string;
}

/** One problem a notarization log reports. */
export interface NotarytoolIssue {
  /** `error` or `warning`. */
  severity?: string;
  /** What is wrong, e.g. `The binary is not signed.` */
  message?: string;
  /** The path inside the archive the issue is about. */
  path?: string;
  /** The CPU architecture of the offending slice. */
  architecture?: string;
  /** Apple's documentation link for the issue. */
  docUrl?: string;
}

/** A submission's notarization log, from `notarytool log`. */
export interface NotarytoolLog {
  /** The submission id the log belongs to. */
  jobId?: string;
  /** The final status, e.g. `Invalid`. */
  status?: string;
  /** A one-line summary, e.g. `Archive contains critical validation errors`. */
  statusSummary?: string;
  /** Every issue the log lists; empty for a clean submission. */
  issues: NotarytoolIssue[];
  /** The log as notarytool printed it. */
  text: string;
}

/** The JSON object in `stdout`, or `undefined` if there is none. */
function jsonObject(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim();
  // The whole output first; then the last line that opens an object, in case
  // a notarytool version prints progress lines ahead of the JSON result.
  const lines = trimmed.split(/\r?\n/).filter((l) =>
    l.trimStart().startsWith("{")
  );
  for (const candidate of [trimmed, lines.at(-1)]) {
    if (candidate === undefined) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      const object = asRecord(value);
      if (object !== undefined) return object;
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return undefined;
}

/** `value` as a plain object, without a cast, or `undefined`. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

/** The string under `key`, or `undefined` when absent or not a string. */
function text(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/** The object in `stdout`, or a {@link NotarytoolOutputError} naming `what`. */
function requireObject(
  stdout: string,
  what: string,
): Record<string, unknown> {
  const object = jsonObject(stdout);
  if (object === undefined) {
    throw new NotarytoolOutputError(
      `notarytool ${what} printed no JSON result. Check that Xcode 13 or ` +
        `later is selected (xcode-select -p); the raw output is on the ` +
        `error's stdout field.`,
      stdout,
    );
  }
  return object;
}

/** Read a submission from one JSON object, or `undefined` without an id. */
function submissionFrom(
  object: Record<string, unknown>,
): NotarytoolSubmission | undefined {
  const id = text(object, "id");
  if (id === undefined || id === "") return undefined;
  const submission: NotarytoolSubmission = { id };
  const status = text(object, "status");
  if (status !== undefined) submission.status = status;
  const message = text(object, "message");
  if (message !== undefined) submission.message = message;
  const name = text(object, "name");
  if (name !== undefined) submission.name = name;
  const createdDate = text(object, "createdDate");
  if (createdDate !== undefined) submission.createdDate = createdDate;
  return submission;
}

/**
 * Parse the JSON `notarytool submit` or `info` printed with
 * `--output-format json`.
 *
 * @throws {NotarytoolOutputError} When there is no JSON object, or it has no
 * submission id.
 */
export function parseSubmission(
  stdout: string,
  what: string,
): NotarytoolSubmission {
  const submission = submissionFrom(requireObject(stdout, what));
  if (submission === undefined) {
    throw new NotarytoolOutputError(
      `notarytool ${what} printed JSON without a submission id; the raw ` +
        `output is on the error's stdout field.`,
      stdout,
    );
  }
  return submission;
}

/**
 * Parse the JSON `notarytool history` printed: the `history` array, with any
 * entry that is not an object carrying an id skipped.
 *
 * @throws {NotarytoolOutputError} When there is no JSON object.
 */
export function parseHistory(stdout: string): NotarytoolSubmission[] {
  const history = requireObject(stdout, "history")["history"];
  if (!Array.isArray(history)) return [];
  const submissions: NotarytoolSubmission[] = [];
  for (const entry of history) {
    const object = asRecord(entry);
    const submission = object === undefined
      ? undefined
      : submissionFrom(object);
    if (submission !== undefined) submissions.push(submission);
  }
  return submissions;
}

/** Read one issue from a log's `issues` entry. */
function issueFrom(object: Record<string, unknown>): NotarytoolIssue {
  const issue: NotarytoolIssue = {};
  const severity = text(object, "severity");
  if (severity !== undefined) issue.severity = severity;
  const message = text(object, "message");
  if (message !== undefined) issue.message = message;
  const path = text(object, "path");
  if (path !== undefined) issue.path = path;
  const architecture = text(object, "architecture");
  if (architecture !== undefined) issue.architecture = architecture;
  const docUrl = text(object, "docUrl");
  if (docUrl !== undefined) issue.docUrl = docUrl;
  return issue;
}

/**
 * Parse the JSON notarization log `notarytool log` printed.
 *
 * @throws {NotarytoolOutputError} When there is no JSON object.
 */
export function parseLog(stdout: string): NotarytoolLog {
  const object = requireObject(stdout, "log");
  const log: NotarytoolLog = { issues: [], text: stdout };
  const jobId = text(object, "jobId");
  if (jobId !== undefined) log.jobId = jobId;
  const status = text(object, "status");
  if (status !== undefined) log.status = status;
  const statusSummary = text(object, "statusSummary");
  if (statusSummary !== undefined) log.statusSummary = statusSummary;
  const issues = object["issues"];
  if (Array.isArray(issues)) {
    for (const entry of issues) {
      const issue = asRecord(entry);
      if (issue !== undefined) log.issues.push(issueFrom(issue));
    }
  }
  return log;
}
