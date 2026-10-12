// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link SignPathTasks}: submit a signing request and wait for it, read a
 * request's status, and download a signed artifact — each configured by a
 * settings lambda that sets the connection and the call's own options.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { connect } from "./connect.ts";
import {
  downloadSignedArtifact,
  requireOutput,
  SignPathDownloadSettings,
} from "./download.ts";
import { fetchStatus, requestIdOf, SignPathStatusSettings } from "./status.ts";
import { submit } from "./submit.ts";
import { SignPathSubmitSettings } from "./submit_settings.ts";
import type {
  SignPathSignedArtifact,
  SignPathSigningRequestStatus,
  SignPathSubmission,
} from "./types.ts";

/** The operations {@link SignPathTasks} exposes. */
export interface SignPathTasksApi {
  /**
   * Submit a signing request, wait for it to complete, and — with
   * `.output(path)` — download the signed artifact.
   *
   * ```ts
   * const { signingRequestId } = await SignPathTasks.submit((s) =>
   *   s.organizationId(orgId).apiToken(token)
   *     .projectSlug("zuke").signingPolicySlug("release-signing")
   *     .gitHubOrigin((g) => g.artifactId(artifactId))
   *     .timeout("30m").output("dist/signed/zuke.zip")
   * );
   * ```
   *
   * @throws {SignPathValidationError} when the GitHub origin did not verify.
   * @throws {SignPathSigningError} when the request ends other than `Completed`.
   * @throws {SignPathTimeoutError} when it is not final within `.timeout(...)`.
   * @throws {SignPathApiError} when SignPath refuses a call.
   * @throws {SignPathRequestError} when a call gets no usable answer.
   */
  submit(
    configure: Configure<SignPathSubmitSettings>,
  ): Promise<SignPathSubmission>;
  /**
   * Read a signing request's status once — no waiting.
   *
   * ```ts
   * const { status } = await SignPathTasks.status((s) =>
   *   s.signingRequestId(id)
   * );
   * ```
   */
  status(
    configure: Configure<SignPathStatusSettings>,
  ): Promise<SignPathSigningRequestStatus>;
  /**
   * Download a completed signing request's signed artifact.
   *
   * ```ts
   * await SignPathTasks.download((s) =>
   *   s.signingRequestId(id).output("dist/signed/zuke.exe")
   * );
   * ```
   */
  download(
    configure: Configure<SignPathDownloadSettings>,
  ): Promise<SignPathSignedArtifact>;
}

/** Typed task functions for SignPath's code-signing service. */
export const SignPathTasks: SignPathTasksApi = {
  async submit(configure) {
    return await submit(configure(new SignPathSubmitSettings()));
  },
  async status(configure) {
    const settings = configure(new SignPathStatusSettings());
    const connection = connect(settings);
    return await fetchStatus(connection, requestIdOf(settings));
  },
  async download(configure) {
    const settings = configure(new SignPathDownloadSettings());
    const connection = connect(settings);
    const id = requestIdOf(settings);
    return await downloadSignedArtifact(
      connection,
      id,
      requireOutput(settings.output_),
    );
  },
};
