// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The results `SignPathTasks` hands back.
 *
 * @module
 */

/**
 * Where a signing request stands, from `GET …/SigningRequests/<id>/Status`.
 *
 * SignPath documents these `status` values: `InProgress`,
 * `WaitingForApproval`, `Completed`, `Failed`, `Denied` and `Canceled` — the
 * last four final. `workflowStatus` is finer-grained (`Submitted`,
 * `RetrievingArtifact`, `ScanningForMalware`, `Processing`, `MalwareDetected`,
 * `ArtifactRetrievalFailed`, …). Both are kept as the strings SignPath sent, so
 * a value added later still reads.
 */
export interface SignPathSigningRequestStatus {
  /** The signing request's id, a GUID. */
  readonly signingRequestId: string;
  /** The status, such as `InProgress` or `Completed`. */
  readonly status: string;
  /** The workflow status, such as `ScanningForMalware`, when sent. */
  readonly workflowStatus: string | undefined;
  /**
   * Whether the request will not change any more: SignPath's `isFinalStatus`,
   * or — should an answer leave it out — whether `status` is one of the four
   * documented final ones.
   */
  readonly isFinalStatus: boolean;
  /** The signing request's page in the SignPath web app. */
  readonly webUrl: string;
}

/** A signed artifact written to disk by `SignPathTasks.download` or `submit`. */
export interface SignPathSignedArtifact {
  /** The path it was written to — the one configured with `.output(...)`. */
  readonly path: string;
  /** Its size in bytes. */
  readonly bytes: number;
}

/** What `SignPathTasks.submit` did: the request, its outcome, the download. */
export interface SignPathSubmission {
  /** The new signing request's id, a GUID. */
  readonly signingRequestId: string;
  /** The signing request's page in the SignPath web app. */
  readonly webUrl: string;
  /** The final status — always `Completed`; anything else throws. */
  readonly status: SignPathSigningRequestStatus;
  /** The signed artifact, when `.output(...)` asked for it to be downloaded. */
  readonly signedArtifact: SignPathSignedArtifact | undefined;
}
