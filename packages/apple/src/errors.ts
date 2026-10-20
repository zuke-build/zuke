// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The errors `@zuke/apple` raises beyond a failed command's own
 * `CommandError`: a notarization Apple did not accept, notarytool output that
 * is not the JSON it promised, and a temporary keychain that could not be set
 * up or torn down.
 *
 * @module
 */

import type {
  NotarytoolIssue,
  NotarytoolLog,
  NotarytoolSubmission,
} from "./notarytool_result.ts";
import { printable } from "./text.ts";

/** The most issues a {@link NotarizationError} message lists. */
const MAX_LISTED_ISSUES = 20;

/** One issue as a line of a {@link NotarizationError} message. */
function issueLine(issue: NotarytoolIssue): string {
  const parts = [printable(issue.severity ?? "issue")];
  const where = [
    issue.path === undefined ? "" : printable(issue.path),
    issue.architecture === undefined
      ? ""
      : `(${printable(issue.architecture)})`,
  ].filter((part) => part !== "").join(" ");
  if (where !== "") parts.push(where);
  parts.push(printable(issue.message ?? "(no message)"));
  return `  - ${parts.join(": ")}`;
}

/** The message for a {@link NotarizationError}. */
function notarizationMessage(
  submission: NotarytoolSubmission,
  log: NotarytoolLog | undefined,
): string {
  const status = printable(submission.status ?? "unknown");
  const lines = [
    `Notarization of submission ${printable(submission.id)} finished with ` +
    `status "${status}"` +
    (submission.message === undefined
      ? "."
      : `: ${printable(submission.message)}`),
  ];
  if (log === undefined) {
    lines.push(
      "  The notarization log could not be fetched; run " +
        "NotarytoolTasks.log with this submission id to read it.",
    );
    return lines.join("\n");
  }
  if (log.statusSummary !== undefined) {
    lines.push(`  ${printable(log.statusSummary)}`);
  }
  lines.push(...log.issues.slice(0, MAX_LISTED_ISSUES).map(issueLine));
  const more = log.issues.length - MAX_LISTED_ISSUES;
  if (more > 0) lines.push(`  … and ${more} more issue(s) in the log.`);
  return lines.join("\n");
}

/**
 * Raised by `NotarytoolTasks.submit` when `.wait()` was set and Apple finished
 * the submission with any status other than `Accepted`. The message names the
 * status and lists the issues from the submission's notarization log, which
 * the task fetched with the same credentials.
 */
export class NotarizationError extends Error {
  /** The error name. */
  override name = "NotarizationError";

  /** Build the error from the finished submission and, if fetched, its log. */
  constructor(
    /** The submission as `notarytool submit` reported it. */
    readonly submission: NotarytoolSubmission,
    /** The submission's notarization log, or `undefined` if it could not be fetched. */
    readonly log: NotarytoolLog | undefined,
  ) {
    super(notarizationMessage(submission, log));
  }
}

/**
 * Raised when `notarytool` did not print the JSON result a task asked for —
 * an older Xcode, a crash, or output that is not a notarytool result at all.
 * The raw output is kept on the error rather than in its message.
 */
export class NotarytoolOutputError extends Error {
  /** The error name. */
  override name = "NotarytoolOutputError";

  /** Build the error from a description of the problem and the raw stdout. */
  constructor(
    message: string,
    /** What notarytool printed on stdout. */
    readonly stdout: string,
  ) {
    super(message);
  }
}

/**
 * Raised by `SecurityTasks.temporaryKeychain` when the keychain cannot be set
 * up for signing: no certificate given, a certificate that is not base64, or
 * an imported certificate holding no codesigning identity, or several that
 * the identity filter cannot tell apart. Never carries a password.
 */
export class KeychainError extends Error {
  /** The error name. */
  override name = "KeychainError";
}

/**
 * Raised by `SecurityTasks.temporaryKeychain` when tearing the keychain down
 * failed — restoring the search list, deleting the keychain, or removing its
 * directory. Every step is attempted regardless; {@link failures} holds each
 * one that threw. When the callback had already failed, that error is the
 * {@link Error.cause}, so neither is lost.
 */
export class KeychainCleanupError extends Error {
  /** The error name. */
  override name = "KeychainCleanupError";

  /**
   * Build the error from the failed cleanup steps and, when setup or the
   * callback had failed first, `{ cause }` holding that error — whatever was
   * thrown, `undefined` included, since its presence is what records that the
   * callback failed.
   */
  constructor(
    /** Each cleanup step that threw, in the order they ran. */
    readonly failures: ReadonlyArray<KeychainCleanupFailure>,
    options?: ErrorOptions,
  ) {
    super(
      "Cleaning up the temporary keychain failed:\n" +
        failures.map((f) => `  - ${f.step}: ${f.message}`).join("\n") +
        (options === undefined
          ? ""
          : "\nThe keychain callback had already failed; see the cause."),
      options,
    );
  }
}

/** One cleanup step of a temporary keychain that threw. */
export interface KeychainCleanupFailure {
  /** What the step was doing, e.g. `delete the keychain`. */
  step: string;
  /** The step's error message. */
  message: string;
}

/**
 * Raised by `ProvisioningProfileTasks` when a profile cannot be read, is
 * expired, or could not be removed after `temporary`. When the callback had
 * already failed before the removal did, that error is the
 * {@link Error.cause}.
 */
export class ProvisioningProfileError extends Error {
  /** The error name. */
  override name = "ProvisioningProfileError";

  /** Build the error; the message is prefixed with `Provisioning profile:`. */
  constructor(message: string, options?: ErrorOptions) {
    super(`Provisioning profile: ${message}`, options);
  }
}

/** One entry of an App Store Connect API error response's `errors` list. */
export interface AppStoreConnectErrorDetail {
  /** The machine-readable code, e.g. `ENTITY_ERROR.ATTRIBUTE.INVALID`. */
  code: string;
  /** The short title. */
  title: string;
  /** The explanation, when the API gave one. */
  detail?: string;
}

/**
 * Raised when the App Store Connect API answers with an error status. The
 * message names the request and every error the API listed; it never carries
 * the API key or the token signed with it.
 */
export class AppStoreConnectError extends Error {
  /** The error name. */
  override name = "AppStoreConnectError";

  /** Build the error from the request, the status and the API's errors. */
  constructor(
    /** The request, e.g. `GET /v1/apps`. */
    readonly request: string,
    /** The HTTP status. */
    readonly status: number,
    /** The errors the response listed, possibly none. */
    readonly errors: ReadonlyArray<AppStoreConnectErrorDetail>,
  ) {
    super(
      `App Store Connect: ${request} failed with HTTP ${status}` +
        (errors.length === 0 ? "." : ":\n" +
          errors.map((e) => `  - ${e.code}: ${e.detail ?? e.title}`).join(
            "\n",
          )),
    );
  }
}

/**
 * Raised by `TestFlightTasks.distribute` when the release cannot go ahead:
 * no app has the bundle id, a beta group does not exist, the build finished
 * processing as `INVALID` or `FAILED`, or it had not finished by the timeout.
 */
export class TestFlightError extends Error {
  /** The error name. */
  override name = "TestFlightError";
}
