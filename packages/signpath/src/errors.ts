// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The ways a SignPath call fails, one type per thing a caller acts on:
 *
 * - {@link SignPathApiError} — SignPath (or something in front of it) refused
 *   the call with a non-2xx status: a wrong token, an unknown project slug.
 * - {@link SignPathRequestError} — no usable answer arrived: the network
 *   failed, the call timed out, or the answer was not shaped as documented.
 * - {@link SignPathValidationError} — the GitHub connector refused to submit
 *   because the build's origin did not verify.
 * - {@link SignPathSigningError} — the signing request reached a final status
 *   other than `Completed`: `Denied`, `Failed` or `Canceled`.
 * - {@link SignPathTimeoutError} — the request was still not final when the
 *   wait ran out.
 *
 * None of them ever carries a credential. Every message is built from text
 * scrubbed of the API token and the GitHub token before the error is
 * constructed, and none keeps the underlying error as a `cause`, because a
 * runtime's own message is exactly where a secret would ride along with
 * nothing to scrub it.
 *
 * @module
 */

/**
 * SignPath refused a call: a non-2xx status that is not a transient one the
 * transport retried.
 *
 * ```ts
 * try {
 *   await SignPathTasks.status((s) => s.signingRequestId(id));
 * } catch (error) {
 *   if (error instanceof SignPathApiError && error.status === 401) {
 *     // the API token is wrong or expired
 *   }
 * }
 * ```
 */
export class SignPathApiError extends Error {
  /** The error name. */
  override name = "SignPathApiError";
  /** The HTTP method of the failing call. */
  readonly method: string;
  /** The endpoint path, such as `/v1/<org>/SigningRequests` (never the host). */
  readonly path: string;
  /** The HTTP status of the answer. */
  readonly status: number;
  /**
   * What SignPath said, when it said anything: the `error`, `detail`, `title`
   * or `message` of a JSON answer, or the start of a plain-text one. Scrubbed
   * of credentials and control characters, and capped in length.
   */
  readonly detail: string | undefined;

  /** Build the error from the failing call and what the server said. */
  constructor(
    method: string,
    path: string,
    status: number,
    detail: string | undefined,
  ) {
    super(
      `SignPath ${method} ${path} failed: HTTP ${status}` +
        (detail === undefined ? "" : `: ${detail}`),
    );
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * A SignPath call produced no usable answer: it could not be sent, it timed
 * out, it was redirected somewhere it must not follow, the download was larger
 * than allowed, or the answer was not shaped as SignPath documents it.
 */
export class SignPathRequestError extends Error {
  /** The error name. */
  override name = "SignPathRequestError";
  /** The HTTP method of the failing call. */
  readonly method: string;
  /** The endpoint path, such as `/v1/<org>/SigningRequests` (never the host). */
  readonly path: string;

  /** Build the error from the failing call and the (scrubbed) reason. */
  constructor(method: string, path: string, reason: string) {
    super(`SignPath ${method} ${path} failed: ${reason}`);
    this.method = method;
    this.path = path;
  }
}

/** One build-system validation error the GitHub connector reported. */
export interface SignPathValidationIssue {
  /** What failed, as the connector worded it (scrubbed and capped). */
  readonly error: string;
  /** The connector's advice on fixing it, when it gave any. */
  readonly howToFix: string | undefined;
}

/**
 * The SignPath GitHub connector refused to create the signing request because
 * the build's origin did not verify — the artifact is not from this workflow
 * run, a job ran on a self-hosted runner, the GitHub token cannot read the
 * run, and the like. {@link issues} lists what the connector reported.
 */
export class SignPathValidationError extends Error {
  /** The error name. */
  override name = "SignPathValidationError";
  /** The validation errors, in the order the connector reported them. */
  readonly issues: readonly SignPathValidationIssue[];

  /** Build the error from the connector's validation errors. */
  constructor(issues: readonly SignPathValidationIssue[]) {
    super(
      "SignPath refused the signing request: the GitHub build's origin did " +
        "not verify —\n" +
        issues.map((issue) =>
          `  - ${issue.error}` +
          (issue.howToFix === undefined ? "" : ` (fix: ${issue.howToFix})`)
        ).join("\n"),
    );
    this.issues = issues;
  }
}

/**
 * A signing request reached a final status other than `Completed` — it was
 * `Denied` by an approver, `Failed` (a malware scan, a processing error, an
 * artifact SignPath could not retrieve) or `Canceled`.
 */
export class SignPathSigningError extends Error {
  /** The error name. */
  override name = "SignPathSigningError";
  /** The signing request's id. */
  readonly signingRequestId: string;
  /** The final status, such as `Denied`. */
  readonly status: string;
  /** The finer-grained workflow status, such as `MalwareDetected`, when sent. */
  readonly workflowStatus: string | undefined;
  /** The signing request's page in the SignPath web app. */
  readonly webUrl: string;

  /** Build the error from the request and the final status it reached. */
  constructor(
    signingRequestId: string,
    status: string,
    workflowStatus: string | undefined,
    webUrl: string,
  ) {
    super(
      `SignPath signing request ${signingRequestId} ended ${status}` +
        (workflowStatus === undefined || workflowStatus === status
          ? ""
          : ` (${workflowStatus})`) +
        ` instead of Completed — see ${webUrl}`,
    );
    this.signingRequestId = signingRequestId;
    this.status = status;
    this.workflowStatus = workflowStatus;
    this.webUrl = webUrl;
  }
}

/**
 * A signing request was still not final when the wait ran out — typically
 * one waiting for a manual approval. The request is left as it is; approve
 * it and fetch the result later with `SignPathTasks.download`.
 */
export class SignPathTimeoutError extends Error {
  /** The error name. */
  override name = "SignPathTimeoutError";
  /** The signing request's id. */
  readonly signingRequestId: string;
  /** The last status seen, such as `WaitingForApproval`. */
  readonly status: string;
  /** How long the wait lasted, in milliseconds. */
  readonly timeoutMs: number;
  /** The signing request's page in the SignPath web app. */
  readonly webUrl: string;

  /** Build the error from the request, its last status and the wait's length. */
  constructor(
    signingRequestId: string,
    status: string,
    timeoutMs: number,
    webUrl: string,
  ) {
    super(
      `SignPath signing request ${signingRequestId} was still ${status} ` +
        `after ${timeoutMs} ms — see ${webUrl}`,
    );
    this.signingRequestId = signingRequestId;
    this.status = status;
    this.timeoutMs = timeoutMs;
    this.webUrl = webUrl;
  }
}
