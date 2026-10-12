// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `SignPathTasks.submit` orchestrator: validate everything, submit through
 * the configured route, wait for the request to complete, and download the
 * signed artifact when asked.
 *
 * A GitHub-origin request is submitted through the connector, but polled and
 * downloaded through the documented REST endpoints, like a direct one — an
 * assumption: SignPath's action polls the connector's mirror of them instead,
 * with the same token.
 *
 * Validation runs before anything is sent — the connection, the request, the
 * output path — so a misconfigured build fails without leaving a signing
 * request behind in SignPath.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { connect, webUrl } from "./connect.ts";
import { downloadSignedArtifact, requireOutput } from "./download.ts";
import { submitWithArtifact } from "./submit_direct.ts";
import { submitWithGitHubOrigin } from "./submit_github.ts";
import { submitRequestOf } from "./submit_request.ts";
import type { SignPathSubmitSettings } from "./submit_settings.ts";
import type { SignPathSubmission } from "./types.ts";
import { waitForCompletion } from "./wait.ts";

/** Submit, wait, and download, as `settings` describe. */
export async function submit(
  settings: SignPathSubmitSettings,
): Promise<SignPathSubmission> {
  const connection = connect(settings);
  const request = submitRequestOf(settings);
  const output = settings.output_ === undefined
    ? undefined
    : requireOutput(settings.output_);
  const { source } = request;
  const id = source.kind === "file"
    ? await submitWithArtifact(connection, request, source.path)
    : await submitWithGitHubOrigin(connection, request, source.origin);
  const link = webUrl(connection, id);
  settings.log_(`SignPath: submitted signing request ${id} — ${link}`);
  const status = await waitForCompletion(connection, id, {
    timeoutMs: settings.timeout_,
    pollIntervalMs: settings.pollInterval_,
  });
  const signedArtifact = output === undefined
    ? undefined
    : await downloadSignedArtifact(connection, id, output);
  if (signedArtifact !== undefined) {
    settings.log_(
      `SignPath: wrote the signed artifact to ${signedArtifact.path} ` +
        `(${signedArtifact.bytes} bytes)`,
    );
  }
  return { signingRequestId: id, webUrl: link, status, signedArtifact };
}
